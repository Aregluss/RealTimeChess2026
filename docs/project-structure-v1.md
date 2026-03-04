# RealTimeChess v1 Project Structure

## Monorepo layout
```text
.
├─ apps/
│  └─ web/
│     ├─ app/
│     │  ├─ page.tsx                 # landing/create game
│     │  ├─ join/page.tsx            # join with code/link
│     │  ├─ game/[gameId]/page.tsx   # live board
│     │  └─ api/
│     │     └─ games/
│     │        ├─ start/route.ts
│     │        ├─ join/route.ts
│     │        └─ [gameId]/
│     │           ├─ state/route.ts
│     │           ├─ move/route.ts
│     │           └─ resign/route.ts
│     ├─ lib/
│     │  ├─ api-client.ts
│     │  ├─ realtime-client.ts
│     │  └─ auth-token.ts
│     └─ components/
│        ├─ ChessBoard.tsx
│        ├─ CooldownOverlay.tsx
│        ├─ ReconnectBlocker.tsx
│        └─ GameStatusBar.tsx
├─ packages/
│  ├─ game-engine/
│  │  ├─ src/
│  │  │  ├─ types.ts
│  │  │  ├─ board.ts
│  │  │  ├─ legal-moves.ts
│  │  │  ├─ apply-move.ts
│  │  │  ├─ check-state.ts
│  │  │  └─ timers.ts
│  ├─ shared-types/
│  │  └─ src/
│  │     ├─ config.ts
│  │     ├─ api.ts
│  │     └─ events.ts
│  └─ server-core/
│     └─ src/
│        ├─ redis-keys.ts
│        ├─ game-repo.ts
│        ├─ game-service.ts
│        ├─ move-service.ts
│        ├─ join-code.ts
│        ├─ auth.ts
│        └─ realtime.ts
└─ docs/
```

## Runtime responsibilities
- `apps/web`: UI and API endpoints.
- `game-engine`: deterministic pure logic, no network/storage.
- `server-core`: storage/realtime/auth orchestration.
- `shared-types`: compile-time + runtime schema alignment.

## Key implementation sequence
1. Build `shared-types` (config + API schemas).
2. Implement `game-engine` pure unit-tested core.
3. Implement `server-core` with Redis-backed atomic operations.
4. Wire API routes to `server-core`.
5. Build minimal board UI with realtime subscription.
6. Add reconnect overlay and forfeit countdown UX.
7. Add spectate-only route (read-only) in later phase.
