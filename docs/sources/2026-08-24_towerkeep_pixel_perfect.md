# TowerKeep & Pixel Perfect — 3D Pixel Art Rendering Notes

**Source:** `2026-08-24_towerkeep_pixel_perfect.raw.json` (9 YouTube videos: metadata, descriptions,
full auto-caption transcripts, plus a 30-comment sample)
**Channel:** [Red Giraffe](https://www.youtube.com/@RedGiraffe404) — solo dev, building **TowerKeep**
(3D pixel art tower defense, Unity, wishlistable on Steam)
**Date fetched:** 2026-08-24
**Why it's here:** cited as visual/technical inspiration for Slime Republics' 3D-world-under-pixel-UI
look. This is a *distillation*, not a transcript — the raw file has the full text.

> **Transformation notes.** Transcripts are YouTube auto-captions, cleaned of rolling-caption
> duplication; `[music]` markers are left in place. They are machine-generated and occasionally
> mis-transcribe terms. Quotes below were checked against the raw text. Nothing was fetched that
> isn't public on the channel.

## The two playlists

Note these are the reverse of what you'd guess from the titles:

| Playlist | Content |
|---|---|
| [`PLyMQ4QpV-7TYuvsHeW6xMolQkufsV_nRD`](https://www.youtube.com/playlist?list=PLyMQ4QpV-7TYuvsHeW6xMolQkufsV_nRD) | **Pixel Perfect** — 5 videos, the rendering pipeline, one technique each |
| [`PLyMQ4QpV-7TZGl6rBCLlLJ7YZT25XcQfI`](https://www.youtube.com/playlist?list=PLyMQ4QpV-7TZGl6rBCLlLJ7YZT25XcQfI) | **TowerKeep — A devlog Series** — 4 videos, the game and its pivot from "Brickwork" |

| Video | Topic |
|---|---|
| [`Mp7eQsiZ_wA`](https://www.youtube.com/watch?v=Mp7eQsiZ_wA) | Crisp 3D pixel rendering — the low-res grid and palette quantization |
| [`TVYu3y2lzYc`](https://www.youtube.com/watch?v=TVYu3y2lzYc) | Outlines from depth + normal buffers |
| [`RU3EReALbEU`](https://www.youtube.com/watch?v=RU3EReALbEU) | Planar water — depth fade, refraction, foam, planar reflections |
| [`fKp-Lg7vAn4`](https://www.youtube.com/watch?v=fKp-Lg7vAn4) | Cloud-shadow coverage and ray-marched god rays |
| [`Ua2EXkOmrpA`](https://www.youtube.com/watch?v=Ua2EXkOmrpA) | **Camera movement** — sub-pixel translation, and why rotation doesn't work |
| [`qh2FpSMCKPw`](https://www.youtube.com/watch?v=qh2FpSMCKPw) | TowerKeep ep. 4 — the pivot, and the occlusion→rotation lesson |
| [`9dRetKkeLAQ`](https://www.youtube.com/watch?v=9dRetKkeLAQ) [`T48Vx-uEbMM`](https://www.youtube.com/watch?v=T48Vx-uEbMM) [`oHT9ZAKhs14`](https://www.youtube.com/watch?v=oHT9ZAKhs14) | Brickwork devlogs — solo-dev process and scope; little rendering content |

## The core pipeline

Everything is built in **Unity URP** as scriptable render passes. The techniques are engine-agnostic;
the implementation is not. Slime Republics is browser/WebGL, so all of this is a *specification to
re-implement*, not code to port.

1. **Two-stage resolution lock.** Render the 3D scene, downsample to a fixed low resolution with
   **point filtering**, then upscale to screen with a **point-clamp sampler**. Bilinear filtering is
   the enemy — it invents colors that were never in the palette and softens the edges that make the
   style read. Every texel maps to a uniform block of screen pixels.
2. **Palette quantization in CIE Lab, not RGB.** Nearest-neighbour in the RGB cube is mathematically
   correct and perceptually wrong (human vision is far more sensitive to green; RGB distance ignores
   luminance sensitivity and chroma compression). Converting to a perceptually-uniform space costs a
   linearize → XYZ → Lab transform per pixel, which parallelizes fine on the GPU.
   - **The consequence that matters most:** the palette becomes *GPU data*, a small swappable array —
     "the look of the game is no longer baked into the assets themselves." Retheming is a uniform
     upload. For a game with three faction colors and seasonal resets, that is a very cheap lever.
3. **Outlines from the G-buffer, never from color.** Color is a dirty signal — a shadow across a flat
   wall reads as an edge. Instead: **depth discontinuity** gives silhouettes, **normal discontinuity**
   gives interior creases. Depth must be linearized (GPUs store it logarithmically) so one threshold
   works at 5m and 50m. Outlines are kept exactly one pixel thin by doing a proximity search sized to
   the target texel. Silhouette wins over crease where both fire.
4. **Outlines must be selective.** Applying them to everything "destroys the readability" — dense
   meshes generate crease edges everywhere. Solution: a channel-encoded mask driven by layer
   membership, respecting occlusion via the depth texture, so only tagged objects get outlined.
   In-game this doubles as communication: an outline says *interactable* or *this is a solid boundary*.
5. **Atmosphere.** Cloud shadows are Perlin noise projected onto a virtual ceiling plane in **world
   space** (reconstructed by unprojecting depth through the inverse view-projection), fed into the
   normal shadow-caster path so every object samples it for free. God rays ray-march the same
   projection. Both fight noise, and the usual fix — blur — "deviates significantly from the pixel art
   aesthetic."

## The load-bearing constraint: the camera cannot rotate

This is the finding with real consequences for Slime Republics.

- Pixel-perfect rendering means objects can only write color into fixed grid cells. Moving the camera
  makes pixels cross cell boundaries non-uniformly, producing shimmer and a squash-stretch wobble.
- **Translation is solved**, elegantly: snap the *render* camera to whole-texel positions, store the
  rounding remainder, and offset a second full-resolution display quad by that remainder. The scene
  renders on a locked grid while the view moves smoothly and continuously.
- **Rotation is not solved.** Quoted directly: *"From my current understanding, rotation is somewhat
  of an unsolvable problem."* Under rotation a screen of pixels cannot all land on fixed grid
  intervals — a cube-map of the scene from many angles would be needed. The three offered mitigations
  (blur, global dither, raising pixelation while rotating) are all described as compromises of the
  aesthetic rather than fixes.

**The design lesson TowerKeep learned the hard way** (ep. 4). Its predecessor "Brickwork" used tall
brick geometry. The causal chain that killed it:

> tall building blocks → **occlusion** → the need for a dynamic camera → which demands **rotation** →
> which "did not play nice with the Pixel Pipeline"

Their fix was to change the *game*, not the renderer: keep a **static isometric camera** and
"design the building blocks in a way where they were less likely to block." Height stayed as a
mechanic (higher ground = more tower range), but the geometry got shorter.

**For Slime Republics:** this makes the isometric, non-rotating camera a load-bearing decision rather
than a stylistic one, and it puts a real constraint on layer-1 architecture — observatories, defenses,
walls, and the monument all have to stay low-profile enough not to hide slimes behind them.

**Untested here:** the source solves translation and rules out rotation, but says nothing about
**zoom**, which Slime Republics needs for its three layer altitudes. Resolution is "just a parameter"
in their pipeline, which suggests a small number of *discrete* zoom stops (one fixed grid per layer)
is safe. Continuous zoom changes texel world-size continuously and is likely the same class of
problem as rotation. Not verified.

## Non-rendering notes worth keeping

- **Readability pressure erodes style.** Brickwork's pixelation effects were "curbed" feature by
  feature to keep the game readable, until it was "bland and generic" — each step justified locally.
  A game with three simultaneous zoom levels and a dense HUD will feel exactly this pressure.
- **Fantasy mismatch.** Bricks made players expect building their own towers and vertical level
  design — directions the game didn't want to go. "When you have a clash between the users' fantasy
  and what the game allows, it typically leads to something disappointing."
- **Emergent world as the pitch.** TowerKeep's stated pillar is a world with physical properties that
  interact — grass that grows, slows enemies, and gets trampled into desire paths; trees that block,
  are choppable, and leave stumps that open a lane. Cited influence: Noita. The nearest analogue for
  Slime Republics is terrain that remembers what happened to it (comet craters, worn paths).

## How this was fetched

See `yt-ingest.sh` in this folder. No install needed — `uv` runs yt-dlp directly.
