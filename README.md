# RealTimeChess

Realtime 2-player chess variant where piece movement follows chess rules, but pieces can move whenever their own cooldown allows.

## Current scaffold state
- Monorepo structure with `apps/web` and shared packages.
- In-memory game service for `start`, `join`, and `state`.
- Custom board setup support for test games.
- Move endpoint reserved for next iteration.

## Planned next slice
- Server-authoritative move validation and apply flow.
- Check timer (`2s`) and disconnect grace (`15s`) enforcement.
- Redis-backed storage replacing in-memory map.
