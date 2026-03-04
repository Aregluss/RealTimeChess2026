# RealTimeChess v1 Architecture

## Goals
- Realtime 1v1 chess variant with piece cooldowns (no alternating turns).
- Deployable on Vercel Hobby (free tier).
- Server-authoritative rules and conflict resolution.
- Short-lived game data only.

## Why this architecture
- Vercel Functions do not host WebSocket servers, so realtime transport uses a managed pub/sub provider.
- Redis with TTL is a direct fit for short-lived lobby/game retention rules.
- End-to-end TypeScript keeps shared types and validation simple.

## Recommended stack
- Frontend: Next.js + React + TypeScript (`apps/web`)
- API: Next.js Route Handlers (Node runtime)
- Realtime: Ably (or Pusher) channels
- State storage: Upstash Redis
- Validation: Zod

## High-level components
- `apps/web`
  - Game board UI, lobby/join screens, reconnect overlay, spectator view (later)
  - Calls REST endpoints for authoritative actions
  - Subscribes to realtime channel for state updates
- `packages/game-engine`
  - Pure rules engine:
    - classical piece movement legality
    - self-check prevention
    - cooldown gating
    - check timer and timeout-loss logic
- `packages/shared-types`
  - API request/response types
  - event payload schemas
  - config types
- `packages/server-core`
  - Redis state repository
  - atomic move application service
  - auth/session helpers
  - realtime publisher abstraction

## Realtime and authority model
- Clients never mutate game state directly.
- Client submits move intent to API.
- Server validates + applies state atomically, increments `version`, publishes `state.updated`.
- Clients render from server snapshots/patches.
- If two moves race, commit order on server decides.

## Lifecycle states
- `LOBBY_WAITING`: host created, waiting for opponent.
- `ACTIVE`: both players present.
- `RECONNECT_GRACE`: one player disconnected; countdown to forfeit.
- `FINISHED`: check-timeout loss, forfeit, resign, or other terminal rule.
- `DISCARDED`: key expired/removed by TTL policy.

## Core configurable timings (ms)
- `JOIN_CODE_TTL_MS = 120000`
- `INACTIVITY_DISCARD_MS = 60000`
- `FINISHED_DISCARD_MS = 60000`
- `DISCONNECT_GRACE_MS = 15000`
- `CHECK_TIMEOUT_MS = 2000`

## Piece cooldown defaults (ms)
- `king: 100`
- `queen: 1000`
- `rook: 1000`
- `bishop: 1000`
- `knight: 1000`
- `pawn: 1000`

## Explicit v1 non-goals
- No account system.
- No long-term game history.
- No draw rules: insufficient material / threefold / fifty-move.
- No bots and spectators in v1 release build (design should remain bot/spectator-ready).
