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

## Vercel deploy checklist
Use this when deploying for internet play.

1. Create a Vercel project from this repo and set **Root Directory** to `apps/web`.
2. Set environment variable:
   - `REDIS_URL` = your cloud Redis connection string (Upstash recommended).
3. Deploy (preview or production).

Important:
- Do not use local Redis for Vercel deploys; serverless instances cannot reach your laptop.
- Without `REDIS_URL`, server will fall back to in-memory state which is not reliable across instances.
