# RealTimeChess v1 State Model (Redis + TTL)

## Redis key layout
- `rtc:game:{gameId}:state` -> JSON authoritative snapshot
- `rtc:game:{gameId}:join_code` -> 6-digit code (TTL 120000ms)
- `rtc:join:{code}` -> `{ gameId }` reverse lookup (TTL 120000ms)

Optional helper keys:
- `rtc:game:{gameId}:lock` -> short lock for atomic update path
- `rtc:game:{gameId}:channel_seq` -> monotonic event id

## Snapshot shape
```json
{
  "gameId": "g_abc123",
  "status": "ACTIVE",
  "version": 18,
  "createdAtServerMs": 1760000000000,
  "lastMoveAtServerMs": 1760000010212,
  "finishedAtServerMs": null,
  "winner": null,
  "finishReason": null,
  "players": {
    "white": {
      "tokenHash": "sha256:...",
      "connected": true,
      "disconnectedSinceMs": null
    },
    "black": {
      "tokenHash": "sha256:...",
      "connected": true,
      "disconnectedSinceMs": null
    }
  },
  "board": {
    "pieces": []
  },
  "cooldowns": {
    "w_king": 1760000010300
  },
  "checkTimers": {
    "whiteInCheckSinceMs": null,
    "blackInCheckSinceMs": 1760000010000
  },
  "config": {
    "checkTimeoutMs": 2000,
    "disconnectGraceMs": 15000,
    "pieceCooldownMs": {
      "king": 100,
      "queen": 1000,
      "rook": 1000,
      "bishop": 1000,
      "knight": 1000,
      "pawn": 1000
    }
  }
}
```

## TTL policy
- Lobby waiting for join:
  - keep `state` TTL aligned with join code TTL: `120000ms`
- Active game:
  - on each successful move/state change, reset `state` TTL to `60000ms`
- Finished game:
  - set/refresh `state` TTL to `60000ms`

## Loss conditions implemented in engine/service
- `CHECK_TIMEOUT`:
  - when side enters check, set `XInCheckSinceMs = now`.
  - if still in check and `now - inCheckSinceMs > checkTimeoutMs`, finish game with opponent winner.
  - if check cleared, reset `inCheckSinceMs = null`.
- `DISCONNECT_FORFEIT`:
  - on disconnect, mark `disconnectedSinceMs = now`, status `RECONNECT_GRACE`.
  - if reconnect within `disconnectGraceMs`, restore `ACTIVE`.
  - if grace exceeded, finish game, disconnected side loses.

## Atomic move apply flow (single writer)
1. Load snapshot and validate token/side.
2. Validate move legality in engine, including self-check prohibition.
3. Validate cooldown (`now >= cooldowns[pieceId]`).
4. Apply move.
5. Set moved piece cooldown `now + pieceCooldownMs[pieceType]`.
6. Recompute check states and timeout losses.
7. Increment `version`.
8. Persist snapshot and refresh TTL in one atomic transaction.
9. Publish `state.updated` or `game.finished`.
