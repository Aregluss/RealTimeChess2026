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

## 2026-03-04 implementation iteration 3 (Redis + realtime + castling)
- Added Redis-backed persistence with memory fallback:
  - new `packages/server-core/src/storage.ts`
  - uses `REDIS_URL` when present; otherwise uses in-memory adapter.
  - persisted records include join code + player tokens + authoritative state.
- Refactored server core APIs to async storage calls:
  - `createGame`, `joinGame`, `getGameState`, `submitMove` are now async.
  - API routes updated to `await` these calls.
- Added realtime channel plumbing:
  - new `packages/server-core/src/realtime.ts`
  - publishes game events on create/join/move/finish.
  - Redis pub/sub used when `REDIS_URL` exists; in-memory emitter fallback otherwise.
  - new SSE endpoint: `GET /api/games/[gameId]/events`.
- UI now consumes realtime stream:
  - game page subscribes via `EventSource` and updates state from server events.
  - polling fallback remains (1.5s).
- Added per-game check timeout config:
  - `CreateGameRequest.checkTimeoutMs` (validated server-side with bounds).
  - creator UI now has `Check timeout (ms)` input.
  - active timeout displayed on game page.
- Added core castling support in game engine:
  - king-side and queen-side castling rules with path and attacked-square checks.
  - castling blocked if king/rook has moved.
  - castling updates both king and rook movement state/cooldowns.
- Added explicit check state in authoritative game state:
  - `checkState.whiteInCheck/blackInCheck`.
  - board UI highlights checked king square with red border.

## Remaining gaps after iteration 3
- En passant is still not implemented.
- Disconnect grace/forfeit flow (15s blackout) still pending.
- No automated test suite yet for new castling/Redis/realtime behaviors.

## 2026-03-04 security pass
- Secret scan run on working tree + git history for common key/token signatures.
  - No leaked credentials found in repository history or current files.
- Hardened randomness:
  - replaced `Math.random()` ID/token generation with Node crypto-based generation.
  - join code now uses cryptographic `randomInt`.
- Reduced sensitive state exposure:
  - removed `tokenHash` from public `GameState.players` shape.
  - deleted obsolete `hash.ts`.
- Hardened Git hygiene:
  - `.gitignore` now ignores `.env*` while allowing `.env.example`.
  - added `.env.example` template for safe env setup.
- Added/kept server-side input validation:
  - gameId, joinCode, move target square, pieceId sanity checks.
  - custom board piece count cap.

## Security caveats still open
- SSE/state endpoints are not auth-gated (gameId-based access model; acceptable for current no-account + future spectator direction, but not private-room grade).
- No rate limiting yet on API routes.
- No dependency vulnerability audit executed in this shell (Node unavailable in agent shell); run locally with `pnpm audit`.

## 2026-03-04 performance/conflict hardening
- Added optimistic CAS writes in storage adapters:
  - new `compareAndSwapGameRecord(gameId, expectedVersion, nextRecord, ttlMs)` in `packages/server-core/src/storage.ts`.
  - Redis implementation uses `WATCH` + `MULTI/EXEC` retries to avoid lost updates under concurrent writes.
- Hardened server move flow in `packages/server-core/src/store.ts`:
  - `submitMove` now retries on CAS conflicts (up to 8 attempts).
  - move requests require `from` and `to`; server rejects stale intents with `PIECE_POSITION_CHANGED`.
  - `expectedVersion` is now advisory telemetry (logged, no strict reject) to allow valid moves to proceed after unrelated state changes.
  - added structured move logs (`[rtc.move.*]`) with timings (`validateMs`, `writeMs`, `publishMs`, `totalMs`), version skew, and reject reasons.
- Reduced expensive read-path work:
  - `getGameState` no longer runs full check/mate recomputation on every read.
  - read path only enforces elapsed check-timeout terminal state and persists it via CAS if needed.
- Reduced client background reads and render churn in `apps/web/app/game/[gameId]/page.tsx`:
  - switched from unconditional 1.5s polling to SSE-first with polling fallback only on stream errors.
  - fallback poll interval is adaptive (`6s` visible, `20s` hidden).
  - replaced per-frame (`requestAnimationFrame`) `nowMs` React updates with `100ms` interval ticks.
  - move payload now includes `from`, and client logs structured events (`[rtc.client.*]`) for submit/accept/reject and transport changes.
- Documentation update:
  - `docs/api-contracts-v1.md` updated to reflect `from` requirement and advisory `expectedVersion`.

## Verification note
- Could not run `pnpm typecheck` in this shell because `pnpm`/`npx` are unavailable in the environment.

## Post-beta security TODOs
- Move `playerToken` out of `localStorage` into HttpOnly cookie/session flow to reduce XSS token theft risk.
- Add auth policy to read endpoints based on desired privacy model:
  - if private rooms: require authorized player/spectator token for `GET /api/games/:gameId/state` and `GET /api/games/:gameId/events`.
  - if public/spectator model: keep open but document this as intentional.
- Add rate limiting for API routes (`start`, `join`, `move`, `state`, `events`) to reduce abuse/DoS risk.
- Run dependency vulnerability audit in network-enabled CI (`pnpm audit --prod`) and track remediation.

## 2026-03-05 UI flow update (host share + auto-join link)
- Host game screen invite controls updated:
  - removed separate `Copy invite link` button.
  - moved `Share invite` to the top of game metadata as the primary action.
  - styled primary invite button with a stronger blue gradient and bold label.
- Share behavior updated:
  - on iOS devices with Web Share support, `Share invite` opens native share sheet.
  - on non-iOS/desktop, `Share invite` copies invite URL and button text switches to `Link Copied` for 3 seconds.
- Join link flow updated:
  - when `/join?gameId=...&code=...` is opened, join runs automatically and redirects straight to `/game/:gameId`.
  - while auto-join is running, the page shows `Joining game...` instead of the manual join button.
  - if this browser already has a local session for that game, `/join` now redirects directly to the game page.

## 2026-03-05 verification
- `pnpm typecheck` passed.
- `pnpm --filter @realtimechess/web build` passed.
- Could not run the `develop-web-game` Playwright client in this environment because the `playwright` package is not installed for the skill script.

## 2026-03-05 social preview scaffolding
- Added reusable site URL resolver for metadata base:
  - `apps/web/lib/metadata.ts`
  - reads `NEXT_PUBLIC_APP_URL` first, then Vercel env vars, then localhost fallback.
- Added global app metadata scaffold in `apps/web/app/layout.tsx`:
  - default title template and description.
  - Open Graph + Twitter card defaults.
  - default image points to new `/opengraph-image`.
- Added root OG image generator:
  - `apps/web/app/opengraph-image.tsx` (Next `ImageResponse`).
- Added invite share route scaffold:
  - `apps/web/app/invite/[gameId]/[code]/page.tsx`
  - route-level `generateMetadata()` for custom invite title/description/image.
  - route immediately redirects users to `/join?gameId=...&code=...`.
- Added invite OG image generator:
  - `apps/web/app/invite/[gameId]/[code]/opengraph-image.tsx`.
- Updated backend join link shape so new games produce shareable invite route:
  - `packages/server-core/src/store.ts`
  - `joinLink` now uses `/invite/:gameId/:code` instead of `/join?gameId=...&code=...`.

## 2026-03-05 social preview verification
- `pnpm --filter @realtimechess/web build` passed and includes:
  - `/opengraph-image`
  - `/invite/[gameId]/[code]`
  - `/invite/[gameId]/[code]/opengraph-image`
- `pnpm typecheck` passed after build refreshed `.next/types`.

## 2026-03-05 Blob-first image URLs + static fallback placeholders
- Added social image URL resolution in `apps/web/lib/metadata.ts`:
  - env-first:
    - `NEXT_PUBLIC_OG_SITE_IMAGE_URL`
    - `NEXT_PUBLIC_OG_INVITE_IMAGE_URL`
  - fallback to repo static assets:
    - `/og/site-default.svg`
    - `/og/invite-default.svg`
- Updated metadata usage:
  - root metadata in `apps/web/app/layout.tsx` now uses `getSocialImageUrl('site')`.
  - invite metadata in `apps/web/app/invite/[gameId]/[code]/page.tsx` now uses `getSocialImageUrl('invite')`.
- Added static placeholder assets:
  - `apps/web/public/og/site-default.svg`
  - `apps/web/public/og/invite-default.svg`
- Added documentation for final asset naming/specs and env wiring:
  - `docs/social-preview-assets.md`
- Updated `.env.example` with social preview env vars.
- Updated API contract example join link to current `/invite/:gameId/:code` shape.

## 2026-03-05 Blob/static verification
- `pnpm --filter @realtimechess/web build` passed.
- `pnpm typecheck` passed.
