# TODO

Decisions taken and work not yet done. Newest first.

---

## Store enumeration — add `Enumerate()`, don't build a strategy layer

**Status:** decided, not implemented. Belongs in `Olve.Utilities`
([PR #74](https://github.com/OliverVea/Olve.Utilities/pull/74), unmerged at time of writing —
adding it there costs no extra release cycle).

**Do:** add a non-allocating `Enumerate()` to `EntityStore<T, TId>` exposing the lock-free
enumerator. Leave `List()` alone.

**Why.** `List()` is `_entities.Values.ToList()` — `Values` takes every lock and builds a `List<T>`,
then `ToList()` copies it again. The copy is essentially the entire cost. Measured, 5000 iterations,
Release, N = 1000:

| | time | allocation |
|---|---|---|
| `.Values.ToList()` — `List()` today | 27.48 µs | 16,104 B |
| `.ToArray()` — one copy | 13.85 µs | 16,024 B |
| `foreach` — lock-free, no copy | **1.07 µs** | **0 B** |
| plain `Dictionary` `foreach` | 0.70 µs | 0 B |
| dense `T[]` loop | 0.51 µs | 0 B |

So `ConcurrentDictionary` is *not* slow to enumerate. Copying is. Dropping the copy is ~26×; every
remaining layout choice put together is ~2×.

**`List()` keeps its snapshot semantics, and that is the real trade — not exceptions.** The
lock-free enumerator is a *live view*: enumerating 100 entries while inserting produced 117
iterations in a test. A frame encoded through it can mix old and new state. `List()` takes all locks
and gives a true point-in-time copy, which is what an HTTP-edited durable store wants. Document
`Enumerate()` as unsafe-for-consistency, for callers that know no writer is active. `SlimeWorld`
qualifies by construction: one mutator thread, commands drained at the top of the tick, nothing
writing during encode.

### Rejected: storage strategies selected at DI registration

1. **The payoff is capped at ~2×** once the copy is gone, against 26× for the free fix.
2. **A thread-safety flag is unsafe by construction.** Same type, same signature; a store registered
   single-threaded and touched from two threads corrupts silently. A distinct type makes it a
   compile error.
3. **It would turn a safe pattern into a crash.** Verified: `ConcurrentDictionary` never throws when
   enumerated during modification, including mutation from inside the loop. `Dictionary` throws
   `InvalidOperationException` immediately, both cross-thread and same-thread.
4. **Columns are not reachable through the interface anyway.** `List() : IReadOnlyList<T>` and
   `TryGet(out T)` mandate one `T` per entity. No backing-store swap changes that — it needs a
   different interface, which is why `SlimeWorld` implements `IEntityStore` for persistence and
   admin while the tick loop reads its columns directly.

---

## Land `ShortId<T>` in the world

**Status:** library side done and unmerged; app side not started.

1. Merge [PR #74](https://github.com/OliverVea/Olve.Utilities/pull/74) — **rebase, no merge commit**
   per that repo's conventions. `feat:` bumps 0.48.0 → 0.49.0 and publishes all eleven packages.
2. Bump the five `Olve.*` pins in `Directory.Packages.props`.
3. Have `SlimeWorld` implement `IEntityStore<Slime, ShortId<Slime>>` over parallel arrays with a
   monotonic `uint` counter. Keep the tick loop on the columns, off the interface.

`ShortId<T>` is four bytes, matching `RealtimeProtocol.SnapshotEntrySize`'s `uint32` id field, so the
wire format does not change. Ids must never be recycled — reuse aliases a stale client reference
onto a new slime.

---

## Documentation loose ends

- **`docs/REALTIME.md` is quarantined.** Oliver's notice at the top says it is unreviewed and must be
  aligned on section by section. Nothing else cites it any more. Its 20 Hz statements are the last
  ones in the repo.
- **CLAUDE.md now carries no protocol summary.** Intended, but a fresh session touching `Realtime/`
  gets no warning about the ticket handshake or close codes.
- **The Game client is drawn but does not exist.** `tech-design.md:35` and the architecture SVG both
  claim three.js and a separate Vite entry point. Neither is real: one `index.html`, no
  `build.rollupOptions.input`, and the only runtime deps are the six Kiota packages. Mark both
  planned, or cut both. They are a matched pair.
- **`game-design-document.md:195`** still says "2D pixel sprites throughout. No 3D", contradicting
  the 3D-world restatement at `:130`. The effort estimates under it were costed against 2D.
- **`game-design-document.md:219`** still says "sharding by zone", which the one-game-server /
  one-game-world model replaced everywhere else.
- **Seven references to a `docs/DESIGN.md` that does not exist**, inherited from
  `Olve.Template.Api`: `EntityStorePersister.cs`, `StorageMode.cs`, `AppJsonContext.cs`,
  `base-element.ts` (×2), `base-element.test.ts`, `message-list.ts`.
