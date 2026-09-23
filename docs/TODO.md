# TODO

Decisions taken and work not yet done. Newest first.

---

## Documentation loose ends

- **The renderer is planned, not built.** The tech design names three.js for the world view; the
  client today draws a debug tile map (`src/frontend/src/game/tile-map.ts`).
- **`game-design-document.md:195`** still says "2D pixel sprites throughout. No 3D", contradicting
  the 3D-world restatement at `:130`. The effort estimates under it were costed against 2D.
- **`game-design-document.md:219`** still says "sharding by zone", which the one-game-server /
  one-game-world model replaced everywhere else.
