# VoxelBound

Voxatron-style voxel **EarthBound RPG engine** + in-browser **Studio**.

Play like EarthBound. Look like Voxatron. Build everything in the browser.

## Repo

https://github.com/matt-meaningfulgigs/voxelbound (private)

## Quick start

```bash
pnpm install
pnpm dev          # playable demo @ http://localhost:5173
pnpm dev:studio   # Studio w/ World Settings @ http://localhost:5174
pnpm test
pnpm build
```

## Packages

| Package | Purpose |
|---------|---------|
| `@voxelbound/shared` | Types, Zod schemas, timing, world settings, voxel model format |
| `@voxelbound/engine` | Three.js runtime — tick scheduler, ECS, voxel renderer, animation, scenes |
| `@voxelbound/game` | Playable demo + content |
| `@voxelbound/studio` | Dev tools (World Settings live preview; creators/editors expanding) |

## Architecture highlights

- **Three clocks**: uncapped render, fixed world sim (60 Hz), slow unified animation steps (~3 Hz)
- **Smooth movement, stepped voxel frames** (EarthBound / Spider-Verse feel)
- **Configurable look** via `WorldSettings` (camera, lighting, tick rates)
- **Archetypes + states** for NPCs/items/tiles (idle, walk, talk, broken, sway…)
- **2.5D layered tile world** (foundation in place)

## Controls (demo)

- **WASD** — move
- **Shift** — run
- **World Settings** panel — tune camera & animation rates live

## Roadmap

See plan in `.cursor/plans/` — RPG systems, Studio creators, interactive grass/water, battles, dialogue, quests, export pipeline.
