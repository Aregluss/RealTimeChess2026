Original prompt: We're going to build and deploy on free tier vercel a 2 player game named, RealTimeChess. Its a recreation of Classic Chess, pieces move the same rules, checks and checkmates exist similarly, with a twist players don't take turns rather each piece which is moved simply has a cooldown until it can be moved again. Lets draft out overall project structure, from game logic, APIs, how two players will play vs each ohter, how game state is represented and stored. (fyi simple way to play vs each other is player making startgame gets a unique password generated, they share it to 2nd player to join, or share a link that hits same join api)

## 2026-03-04 planning decisions
- No accounts for v1. Join and play with short-lived join code.
- Join code format: 6-digit numeric.
- Join code TTL: 120000ms.
- If game state is unchanged for 60000ms, discard game.
- If game is finished for 60000ms, discard game.
- No long-term history retention beyond TTL windows.
- Piece cooldowns are configurable in milliseconds.
- Initial cooldowns:
  - king: 100ms
  - queen/rook/bishop/knight/pawn: 1000ms
- Server ordering/timestamps are authoritative for move conflicts.
- Client may run local validation hints, but server is final validator.
- Draw rules postponed for v1:
  - insufficient material
  - threefold repetition
  - fifty-move rule
- Promotion is auto-queen for v1.
- Check rule variant:
  - Being in check does not freeze your other moves.
  - If a side remains in check longer than 2000ms (configurable), that side loses.
- Disconnect handling:
  - if a player disconnects, game enters reconnect grace of 15000ms.
  - if player does not reconnect within grace, disconnected side loses by forfeit.

## Next TODO
- Build initial monorepo scaffold (`apps/web`, `packages/*`).
- Implement server-authoritative move endpoint with Redis atomic update.
- Add realtime channel wiring and reconnect/check timers.

## 2026-03-04 implementation iteration 1
- Scaffolded monorepo:
  - `apps/web` (Next.js app skeleton)
  - `packages/shared-types`
  - `packages/game-engine`
  - `packages/server-core`
- Implemented first API slice with in-memory server core:
  - `POST /api/games/start`
  - `POST /api/games/join`
  - `GET /api/games/:gameId/state`
  - `POST /api/games/:gameId/move` placeholder (`501`)
- Implemented board setup engine:
  - `classic` board generator
  - `custom` board generator with square and duplicate checks
  - allows sparse/empty custom boards for testing.
- Added initial TTL pruning logic in in-memory service:
  - join code expiry
  - inactivity discard
  - finished-state discard
- Added root workspace/config files and README.
- Fixed shared-types import issue for API config typing.

## Iteration 2 TODO
- Replace in-memory state with Redis repository (same API service shape).
- Implement move apply endpoint and server-authoritative validation:
  - legal movement
  - cooldown checks
  - self-check rejection
  - version increment + state patch response
- Add check timer enforcement (`CHECK_TIMEOUT_MS`) and disconnect grace/forfeit (`DISCONNECT_GRACE_MS`).
- Add automated tests for board setup and move/cooldown rules.
- Note: runtime tests were not executed in this environment because `node` is unavailable.

## 2026-03-04 implementation iteration 2 (move slice)
- Implemented `packages/game-engine/src/moves.ts`:
  - legal movement rules for king/queen/rook/bishop/knight/pawn
  - pawn double-step from start rank and diagonal captures
  - pawn auto-promotion to queen on last rank
  - self-check rejection (`SELF_CHECK`)
  - king-in-check detection
- Implemented server-authoritative move flow in `packages/server-core/src/store.ts`:
  - `submitMove(gameId, payload, authToken?)`
  - player-token ownership checks
  - cooldown enforcement with `COOLDOWN_ACTIVE`
  - version mismatch rejection support
  - check timer processing (`CHECK_TIMEOUT`)
- Replaced move API placeholder with working handler:
  - `POST /api/games/[gameId]/move`
  - reads bearer token from `Authorization` header
- Upgraded UI for local 2-browser play:
  - start/join pages now persist session token + side in localStorage
  - game page renders clickable 8x8 board with chess glyphs
  - click own piece then destination to submit move
  - polling updates state every 500ms

## Remaining gaps after iteration 2
- Castling and en passant are not implemented yet.
- Disconnect grace/forfeit flow is not implemented yet.
- Redis persistence is not implemented yet (in-memory store still used).
