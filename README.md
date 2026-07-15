## Sona

A 3D helix-drop for Reddit’s Devvit platform — built for the **Games with a Hook** hackathon.

**Brand:** Sona  
**App:** [sonagame](https://developers.reddit.com/apps/sonagame)  
**Demo subreddit:** [r/sonagame_dev](https://www.reddit.com/r/sonagame_dev)

Spin the shaft, bounce on ivory, fall through gaps, never touch red. Everyone plays the same **Daily Core** until UTC midnight. Keep your streak. Climb the depth board.

### Stack

- **Devvit Web** + Vite
- **Three.js** (3D bounce physics)
- **Hono** server + Redis (scores, streaks)

### Play loop (the hook)

1. **Daily Core** — same seeded tower for everyone that day  
2. **Streaks** — play each UTC day to keep the fire  
3. **Levels** — Align → Fracture → Pressure → Nadir  
4. **Leaderboard** — deepest divers today  

### How to play

1. Open a Sona post on [r/sonagame_dev](https://www.reddit.com/r/sonagame_dev)  
2. Tap **PLAY TODAY**  
3. Spin with drag or ◀ ▶ · land **ivory** · drop **gaps** · avoid **red**  
4. Go deeper. Beat today’s best. Come back tomorrow for a new core.

### Controls

- **Drag** left/right (or A/D · ←/→) to rotate  
- Mobile: on-screen ◀ ▶  
- Ivory = safe · Gap = drop · Red = fail  

### Commands

```bash
npm install
npm run login          # Reddit developer login
npm run build          # Build client + server
npm run dev            # Live playtest on Reddit
npm run deploy         # Type-check, lint, upload
npm run launch         # Upload + publish for review
```

> Requires Node 22+

### Hackathon submission

| Field | Value |
| ----- | ----- |
| App listing | https://developers.reddit.com/apps/sonagame |
| Demo subreddit | https://www.reddit.com/r/sonagame_dev |
| Demo post | Create via mod menu **Create Sona post** in that sub |

Optional: developer feedback survey for Feedback Awards.
