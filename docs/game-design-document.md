# Slime Republics — Game Design Document

**Status:** High Level Concept/Design and Product Design filled from the
[inception discussion](sources/2026-08-24_inception_discussion.md); Detailed & Game Systems Design is
still `_TBD_`.
**Scope:** this document describes the **full vision**, not the first prototype. Where a section
names something not yet built, that is deliberate.
**Template:** [Game Design Concept and Pitch Template](sources/2018-02-22_game_concept_document_template.md) by Michael Sellers.

> Fill a section by replacing its `_TBD_` with prose. Leave the italic prompt in place — it is the
> template's own guidance and stays useful as the document grows. Grep for `_TBD_` to see what is
> still open.

---

## High Level Concept/Design

### Working title

> *Your game's title should communicate the gameplay and the style of the game*

**Slime Republics.**

"Slime" sets the register: cute, wobbly, slightly violent pixel creatures, low personal stakes.

"Republics" sets the structure: every faction's hierarchy is elective, so power is held rather than owned.

The tension between the two words is the game — solemn institutions staffed by blobs.

### Concept statement

> *The game in a tweet: one or two sentences at most that say what the game is and why it's fun.*

A massively-multiplayer browser game where three factions of slimes fight across one continuous world, played simultaneously at three levels of abstraction: you are a slime, or you command twenty, or you draw the theatre of war.

It's fun because all three are real games running at once on the same state. The general redrawing the map and the slime fighting over a rock are in the same world at the same moment, and each can feel the other.

### Genre(s)

> *Single genre is clearer but often less interesting. Genre combinations can be risky. Beware of 'tired' genres.*

A **persistent-world MMO** whose three layers each borrow a different genre's shape:

- **Layer 1** — real-time action, isometric, action-cooldown gameplay, cute pixel combat and resource gathering.
- **Layer 2** — real-time strategy with a bounded map, resources and a set of units, except the units are people for you to manage, direct, and support.
- **Layer 3** — grand strategy where you decide the strategy for the next two hours of play, drawing the battlefield, directing your commanders, and determining how to balance the resources of your faction.

The combination is the risk and the point. The mitigation is that these are not three games in a trenchcoat; they are three viewports and three verb sets over **one world state**.

Zooming out is promotion; layer 2's view is layer 1's map from above, and layer 3's is the region containing every active map.

### Target audience

> *Motivations and relevant interests; potentially age, gender, etc.; and the desired ESRB rating for the game.*

Somewhere between the playerbase of Reddit's places event and Rust.

Players who come for **other people** and to actively participate in their faction in the way they want. Three overlapping motivations, one per layer:

- **Layer 1** — moment-to-moment action and visible personal progress; players who want to log in for twenty minutes and fight over something. Layer 1 is not necessarily simple but is less strategical. You still choose which buildings to contribute to, how to upgrade your single slime, and where you wander.
- **Layer 2** — the support/shotcaller instinct; players who enjoy making a group of people better at what they were already doing.
- **Layer 3** — the strategist and the politician; players who want consequential decisions and are willing to negotiate with rivals to get them.

The layers should get progressively more demanding in what to pay attention to. It's impossible to do everything at layer 3 so a successful player focuses on the right things to maximize impact.

Nobody is required to climb. A player who never leaves layer 1 should have a complete game.

Broadly **teen-and-up (ESRB T)**: cartoon violence, no gore, no realistic weapons — but with player-to-player communication and player-run power structures, which is the actual reason for the rating and a real design obligation (see Game Systems, `_TBD_`).

### Unique Selling Points

> *Critically important. What makes your game stand out? How is it different from all other games?*

**1. Three layers of abstraction, played simultaneously, by different people, on one world.**
Hierarchical strategy games are usually one player operating a stack of menus. Here each tier of the
hierarchy is a different human, playing live, at their own clock speed — seconds at layer 1, tens of
seconds at layer 2, hours and days at layer 3. A slime can look up and see the front line their
commander is arguing about; a general can watch their decision land as slimes flood a tile.

**2. Cozy game you come back to.**
<to be filled>

**3. Massive multiplayer, quick drop in drop out.**
<to be filled>

**Supporting differentiators**, which matter but do not lead:

- **Command by incentive, never by order.** <there should be a chat so it's natural that there will be directions or orders given but it's not enforced directly by the game>
- **Elective hierarchy and player-authored culture.** Seats are climbed to and lost. Factions name
  their own ranks and invent their own politics; the developers lean into whatever meaning the
  player base assigns each color rather than authoring it up front. <Ideally, I want fan art giving the factions personalities. This is why I suggested Blue, Black, and Pink. I think all have different inherent symbolism so hopefully the players pick up on that and make it their own.>
- **Three-faction diplomacy where third place has the leverage.** <Actually, I think it'd be better if everyone just plays to win and there's no point in being #2>
- **A physical win condition.** The endgame is not a counter in a menu. It is one ordinary,
  glowing, slow slime waddling across open ground with the faction's entire haul on its back,
  visible to everyone, lootable by anyone. <Let's not determine this in the design doc directly. I think standings and progress on the win condition should be public. I like the idea of the resource carrier being ambushed, but I also like the idea of a team keeping their high resource count covert until they finally gamble it all and cash it in for a win.>

## Product Design

### Player Experience and Game POV

> *Who is the player? What is the setting? What is the fantasy the game grants the player? What emotions do you want the player to feel? What keeps the player engaged for the duration of their play?*

**Who the player is** depends on which layer they are standing on. (Whether a player occupies exactly
one layer at a time, or can drop back down to fight while holding a seat, is unsettled — see the open
questions under Detailed & Game Systems Design.)

- **Layer 1 — the slime.** Third-person, one body, one color. You fight other factions' slimes over
  resources, haul what you win, raise buildings your faction depends on, and upgrade yourself. Death
  is comic and cheap: you splatter, you wobble back together fifteen seconds later. Your real
  investment is your upgrades and your merit, never your body.
- **Layer 2 — the commander.** Roughly twenty slimes, seen from above. You can scroll around the map and see what your slimes and buildings reveal. You have a resource pool that ticks in, bounties to place, and cooldown-gated interventions. You can communicate to your slimes and set visual waypoints and markers — addressed to the whole team or to an individual slime — but you cannot force anyone to do anything. You have the best tactical overview of the game, with layer 1's view too narrow and layer 3's view too aggregated and broad.
- **Layer 3 — the leadership.** The region containing every active map. You choose which sections will support your slimes, strategize to increase your factions resource harvesting potential, order the construction of large-scale buildings such as tunnels that warp slimes across the world, continuously reallocate a fixed pool of regional buffs, negotiate with the other two factions' leaderships.

**The fantasy** is *being part of something with a shape* but also *something that can be torn down without sustained team work*. Most MMOs grant power fantasy; this one grants **position** — the feeling that there are people above you making decisions you can feel, and that you could be one of them, and that they had to earn it from people like you.

**The emotions we want**, per layer: at layer 1, scrappy urgency, contributing to your little group, and cooperating with your team mates in raids, supported by the higher layers. At layer 2, attentive care for twenty specific slimes, feeling your impact shift the tide of the battle. At layer 3, the weight of consequential decisions and the dirty pleasure of a deal, finding your strategic decision made 1 hour ago pays off for your faction to gain the upper hand.

**What sustains engagement** across a session and across weeks:

- **Short arc:** a fight, a haul, a comet.
- **Medium arc:** a building raised, a squad kept alive, a front opened.
- **Long arc:** a monument bar climbing, a tunnel network inherited, a seat climbed toward.
- **A visible standings readout at all three layers.** <rewrite based on my feedback>
- **Seasons.** A faction wins in roughly two weeks; the world resets and the person persists. The pit is never more than days from ending.

### Visual and Audio Style

> *What is the "look and feel" of the game? How does this support the desired player's experience? What concept art or reference art can you show to give the feel of the game?*

**Cute, slightly violent pixel art — the same pixel art at every layer.** No stylistic break between the slime's-eye view and the war table. Layer 3's map is literally a zoomed-out rendering of the tiles layer 1 walks on.

Tiled and isometric. Slimes are rounded, bouncy, viscous cubes jumping around.

Audio: chunky, wet, and low-fi. Squelch, plop, and a bass thud for a comet. The soundscape should carry rank — a layer 3 player hears the world muted and distant, a slime hears it up close. No in-game voice chat. In-game emoji system with accompanying cute slime voices.

*Concept and reference art: `_TBD_`.*

### Game World Fiction

<REACHED HERE IN MANUAL PASS>

> *Briefly describe the game world and any narrative in player-relevant terms (as presented to the player).*

There is deliberately **very little authored fiction**, and that is the design.

What the player is told: the world is a tiled continent. Three slime factions — **blue, black, and
pink** — contest it. At the center stands a monument that will answer to whichever faction feeds it
enough. Comets fall carrying rare material. That's roughly it.

Everything else is written by the players. Each faction gets a renameable banner, a faction name, and
editable title strings for its three ranks. What blue *stands for* is not in this document and will
never be, because community identity does not emerge from a color — it emerges from mechanical
asymmetry plus time. Give each faction a slightly different economic or ability shape and players
will invent the lore that explains it. The developers' only narrative job is to notice which
interpretation the player base has settled on and lean into it.

One faction ends up a solemn theocracy. One is a bureaucratic nightmare with committee minutes in the
Discord. One calls their leader "the guy." None of that is written by us.

**Seasonal narrative** is the one authored beat: the monument completes, erupts in the winner's
color, and the map belongs to them for a few minutes while everyone — including the losers — stands
there watching. The winner's banner then flies over the next season's central monument. Victory
theater is the memory people come back for, and it costs almost nothing to build.

### Monetization

> *How will the game make money? Premium purchase? F2P? How do you justify this within the design?*

**Free to play, with cosmetic-only monetization considered later.** Nothing is sold at launch.

The justification is structural rather than ethical-posturing: the design's core bet needs hundreds
of concurrent players before it demonstrates its thesis at all, so any entry price is a direct tax on
the one resource the game cannot do without. Free entry is a *feasibility* requirement.

If monetization arrives, it is **cosmetic only, and never anything that affects play** — slime skins,
banners, season-marked titles and rank badges. This is also exactly what the season reset already
produces for free: seasons reward with identity, not power, so a cosmetic storefront sits naturally
alongside the existing reward structure instead of competing with it.

Explicitly ruled out: anything purchasable that affects combat, resources, buffs, merit accrual, or
seat eligibility. A faction hierarchy that can be bought into is not a republic, and the elective
layer is the game.

### Platform(s), Technology, and Scope (brief)

> *PC or mobile? Table or phone? 2D or 3D? Unity or Javascript? How long to make, and how big a team? How long to first-playable? How long to complete the game? Major risks?*

**Platform.** Browser, desktop-first. No download, no install, no store — a link is the entire
onboarding path, which matters enormously for a game that needs a crowd. Layer 3's slower cadence is
a natural fit for a phone at lunch, so mobile is a later target for that layer specifically rather
than for the whole game.

**Rendering.** 2D pixel sprites throughout, WebGL-batched. No 3D.

**Server.** A single authoritative .NET process holding the whole world in memory, with a fixed tick
loop as a `BackgroundService` and raw binary WebSockets rather than SignalR or JSON. Input commands
land in a queue that the tick drains; world state is never mutated from a socket handler. The world
is in-process singleton state, which means **exactly one replica** — scaling out means sharding by
zone, never adding pods. See [REALTIME.md](REALTIME.md) for the protocol and the constraints that
enforce this.

**Team and timeline.** Solo developer with realtime experience, AI-assisted. A first playable slice is
a matter of months; **the full game as described is not a solo project** — realistically a funded team
of 6–10 over 2–3 years. This document describes the destination. What gets built first, and in what
order, is not decided here.

**Major risks**, in the order they are likely to kill the project:

1. **Population, not servers.** At 20:1, layer 2 needs twenty concurrent slimes to feel like
   anything and layer 3 needs the whole pyramid staffed across three factions — realistically
   500–1,000 concurrent players before the design proves its own thesis. Below that, maps are empty
   and seats are inert, and inert seats are *deliberately* unfun. This cannot be soft-launched into,
   because the early experience is the broken one.
2. **The core bet is untested and hard to test.** The design assumes commanding real humans is fun
   *and* that being commanded feels good rather than like being someone's unit. Neither half can be
   validated with bots or alone — only by putting real people on both sides of a seat. Everything
   above layer 1 rests on this being true.
3. **Netcode at scale.** Server-authoritative combat at ~20Hz with interest management is solved but
   not free; the classic failure is a build that is fine at thirty players and falls over at three
   hundred. Client-side interpolation is the specific thing that eats the time.
4. **Moderation and politics.** Elective hierarchy invites griefers seeking command, vote brigading,
   alt accounts, and a leader who logs off mid-siege out of spite. Games with player-run power
   structures reliably spend more on this than on gameplay, and it is not currently budgeted.

## Detailed & Game Systems Design

> **Not yet drafted.** The source material covers much of this — tile activation and the influence
> pool, comets and prediction cones, the monument haul, merit and promotion, upkeep and anti-snowball,
> seasons and what survives a reset. It is deliberately deferred to a later pass rather than being
> half-specified here.
>
> **Open questions to settle first:**
>
> - **Layer sizing.** The inception discussion leaves 20:1 (a fixed *ratio*, so manager counts float
>   with population) unreconciled against fixed *seat counts* per faction (so population advantage
>   converts into management dilution instead of raw dominance). Nearly every system below depends on
>   which one is true.
> - **Layer occupancy.** Whether holding a layer 2 or 3 seat means you *are* that layer for the
>   session, or whether you can drop back down to your slime while your seat idles, was never settled.
>   It determines what handover, deputies, and logout mean.

### Core Loops

> *How do game objects and the player's actions form loops? Why is this engaging? How does this support player goals? What emergent results do you expect/hope to see? If F2P, where are the monetization points?*

_TBD_

### Objectives and Progression

> *How does the player move through the game, literally and figuratively, from tutorial to end? What are their short-term and long-term goals (explicit or implicit)? How do these support the game concept, style, and player-fantasy?*

_TBD_

### Game Systems

> *What systems are needed to make this game? Which ones are internal (simulation, etc.) and which does the player interact with?*

_TBD_

### Interactivity

> *How are different kinds of interactivity used? (Action/Feedback, ST Cog, LT Cog, Emotional, Social, Cultural) What is the player doing moment-by-moment? How does the player move through the world? How does physics/combat/etc. work? A clear, professional-looking sketch of the primary game UX is helpful.*

_TBD_
