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
iterations in a test. A read encoded through it can mix old and new state. `List()` takes all locks
and gives a true point-in-time copy, which is what an HTTP-edited durable store wants. Document
`Enumerate()` as unsafe-for-consistency, for callers that know no writer is active.

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
   different interface. A hot read path that wants columns reads them directly, off the interface.

---

## Land `ShortId<T>`

**Status:** library side done and unmerged; app side awaits the game-state redesign.

1. Merge [PR #74](https://github.com/OliverVea/Olve.Utilities/pull/74) — **rebase, no merge commit**
   per that repo's conventions. `feat:` bumps 0.48.0 → 0.49.0 and publishes all eleven packages.
2. Bump the five `Olve.*` pins in `Directory.Packages.props`.

`ShortId<T>` is a compact four-byte identifier — the intended id type for game entities once the
world model is designed. Ids must never be recycled — reuse aliases a stale reference onto a new
entity.

---

## Documentation loose ends

- **The Game client is drawn but does not exist.** The tech-design components table and the
  architecture SVG both describe three.js and a separate Vite entry point. Neither is real yet: one
  `index.html`, no `build.rollupOptions.input`, and the only runtime deps are the six Kiota packages.
  Both are kept as *planned* — the chosen renderer and bundle shape — not as anything that ships
  today.
- **`game-design-document.md:195`** still says "2D pixel sprites throughout. No 3D", contradicting
  the 3D-world restatement at `:130`. The effort estimates under it were costed against 2D.
- **`game-design-document.md:219`** still says "sharding by zone", which the one-game-server /
  one-game-world model replaced everywhere else.
- **Seven references to a `docs/DESIGN.md` that does not exist**, inherited from
  `Olve.Template.Api`: `EntityStorePersister.cs`, `StorageMode.cs`, `AppJsonContext.cs`,
  `base-element.ts` (×2), `base-element.test.ts`, `message-list.ts`.
