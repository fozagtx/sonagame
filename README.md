# Sonafall (Sona)

A 3D helix-drop built for Reddit’s **Games with a Hook** hackathon — played inside the post, shared with the whole sub every day.

**Play (public):** [r/sonafall](https://www.reddit.com/r/sonafall) · **Demo post:** [Sona: how deep can you drop today?](https://www.reddit.com/r/sonafall/comments/1uxnxz5/sona_how_deep_can_you_drop_today/) · **App:** [sonagame](https://developers.reddit.com/apps/sonagame)

---

## Inspiration

Helix Jump is pure tension: one ball, a spinning tower, and a single bad landing ending the run. Reddit is pure shared ritual: everyone shows up to the same post, same day, same joke.

Sonafall sits in that overlap. What if the *same* seeded core dropped for the whole subreddit until UTC midnight? Not a private high-score island — a daily descent you argue about in the comments, chase on the board, and come back tomorrow to keep the streak.

The vibe is reactor-shaft RPG rather than candy arcade: ivory plates, red kills, cyan glass vessels, and a living dive-core mascot on the cards.

## What it does

Sonafall is a **Daily Core** helix-drop inside a Reddit custom post:

- **Spin** the shaft (drag or on-screen ◀ ▶)
- **Land** on ivory · **fall** through gaps · **die** on red
- Everyone plays the **same tower seed** until UTC midnight
- **Streaks**, **depth leaderboard**, and soft stage bands (Align → Fracture → Pressure → Nadir)
- **Loadout** armory: pick your vessel (ball skin) and realm (environment)
- **Forge**: community ring blueprints that can appear in the daily seed
- RPG hub cards with a painted **mascot** that reacts on clear / pause / menu
- Procedural shaft world: water, clouds, grass, streaming rock bands that fade in as you dive

Open the post → Drop in → go deeper → beat today’s board → come back tomorrow.

## How we built it

| Layer | Stack |
| --- | --- |
| Platform | **Devvit Web** (custom post in Reddit’s iframe) |
| Client | **Vite** + **Three.js** (3D tower, bounce physics, shaft world) |
| Server | **Hono** + **Redis** (init, scores, streaks, blueprints) |
| Shared | Seeded tower gen, level bands, loadout catalog |

Client loop: fixed-step physics, ring shatter, danger callouts, hub/loadout/achieve overlays, beat-driven synth music. World dressing streams in Y-bands so the shaft feels alive without loading a mile of geometry. Scores and the daily seed live on the server so the hook is real for every player on the sub.

## Challenges we ran into

- **Reddit iframe reality** — short post frames clip UI; hub layout, Drop-in CTA, and FOV had to be tuned for the post box, not a full browser tab
- **Hook vs interrupt** — early “level clear” freezes every N rings felt like spam; achievement now only fires when the **full core** is cleared
- **Environment without sludge** — WebGPU demos don’t port cleanly; we rebuilt water/sky/grass for WebGL and killed floating mist planes that blocked the dive
- **Cosmetic loadout vs stage mood** — realm choice had to stick for the whole run while depth still tightened fog and lights
- **Brand media** — profile/banner aren’t shipped by `devvit upload`; they must be uploaded in the Reddit developer portal and sub look-and-feel UI

## Accomplishments that we're proud of

- A **true daily shared seed** — the Games-with-a-Hook loop, not just a score API bolted on
- 3D dive that still reads in a **tall Reddit post** on mobile
- RPG loadout (vessel + realm) with live preview and persistence
- Procedural shaft streaming with appear transitions
- Win card + hub mascot that feels like a real companion, not a sticker SVG
- Forge path for community rings feeding the day’s tower

## What we learned

- On Reddit, the **frame is the product** — every pixel of hub chrome competes with the playable canvas
- The strongest hook is **shared fate** (one seed, one day), not another private endless mode
- Restraint beats spectacle mid-run; save the big card moments for **core clear**
- Devvit Web is powerful once you treat deploy, install, Redis, and listing assets as separate shipping steps

## What's next for Sonafall

- Ship polished community icon + banner on the live listing and r/sonagame_dev
- More vessels / realms and seasonal Daily Core themes
- Deeper Forge (rated blueprints, featured community rings)
- Friend ghosts / “beat this diver” challenges on today’s seed
- Publish beyond the test sub and tune onboarding for first-time Reddit players
- Optional expanded play surface when Devvit allows, without breaking the in-post loop

---

## Play

1. Open the public demo: [r/sonafall](https://www.reddit.com/r/sonafall/comments/1uxnxz5/sona_how_deep_can_you_drop_today/)
2. Tap **Drop in**
3. Ivory safe · gaps fall · red kills
4. Beat today’s depth. Protect the streak. New core at UTC midnight.

**Controls:** drag / A·D / ←→ · mobile ◀ ▶

## Brand assets

Upload pack: `assets/upload-pack/` (not applied by deploy).

1. [App listing](https://developers.reddit.com/apps/sonagame) → media → profile + banner  
2. [r/sonafall](https://www.reddit.com/r/sonafall) → Mod Tools → Look and feel → icon + banners  

| File | Use | Size |
| --- | --- | --- |
| `assets/profile-photo.png` | Profile / community icon | 1024×1024 |
| `assets/app-icon.png` | App icon | 1024×1024 |
| `assets/app-banner.png` | Desktop banner | 1920×384 |
| `assets/banner-mobile-1600x480.png` | Mobile banner | 1600×480 |

## Commands

```bash
npm install
npm run login          # Reddit developer login
npm run build          # Build client + server
npm run dev            # Live playtest on Reddit
npm run deploy         # Type-check, lint, upload
npm run launch         # Upload + publish for review
```

Requires **Node 22+**.

## Hackathon links

| Field | Value |
| ----- | ----- |
| App | https://developers.reddit.com/apps/sonagame |
| Demo sub (public) | https://www.reddit.com/r/sonafall |
| Demo post | https://www.reddit.com/r/sonafall/comments/1uxnxz5/sona_how_deep_can_you_drop_today/ |
