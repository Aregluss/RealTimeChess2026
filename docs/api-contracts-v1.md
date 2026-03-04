# RealTimeChess v1 API Contracts

All endpoints are server-authoritative. Client-side validation is optional UX only.

## Auth model
- No accounts.
- `playerToken` is minted at start/join and sent as `Authorization: Bearer <token>`.
- Spectators (later) receive read-only token.

## 1) Start game
`POST /api/games/start`

Request:
```json
{
  "hostDisplayName": "optional"
}
```

Response `201`:
```json
{
  "gameId": "g_abc123",
  "joinCode": "483920",
  "joinExpiresAtMs": 1760000000000,
  "joinLink": "/join?gameId=g_abc123&code=483920",
  "playerToken": "<host-token>",
  "side": "white",
  "config": {
    "joinCodeTtlMs": 120000,
    "inactivityDiscardMs": 60000,
    "finishedDiscardMs": 60000,
    "disconnectGraceMs": 15000,
    "checkTimeoutMs": 2000,
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

## 2) Join game
`POST /api/games/join`

Request:
```json
{
  "gameId": "g_abc123",
  "joinCode": "483920",
  "displayName": "optional"
}
```

Response `200`:
```json
{
  "gameId": "g_abc123",
  "playerToken": "<guest-token>",
  "side": "black",
  "state": { "..." : "authoritative snapshot" }
}
```

Errors:
- `410`: join code expired
- `409`: game already full
- `404`: game not found/discarded

## 3) Get state
`GET /api/games/:gameId/state`

Response `200`:
```json
{
  "gameId": "g_abc123",
  "version": 17,
  "status": "ACTIVE",
  "board": {},
  "cooldowns": {},
  "timers": {
    "whiteInCheckSinceMs": null,
    "blackInCheckSinceMs": 1760000010000,
    "disconnect": {
      "whiteDisconnectedSinceMs": null,
      "blackDisconnectedSinceMs": null
    }
  },
  "lastMoveAtServerMs": 1760000010200
}
```

## 4) Submit move
`POST /api/games/:gameId/move`

Request:
```json
{
  "pieceId": "w_pawn_e2",
  "from": "e2",
  "to": "e4",
  "promotion": null,
  "clientSentAtMs": 1760000010200,
  "expectedVersion": 17
}
```

Rules:
- `promotion` ignored unless pawn promotion is reached; v1 auto-queen.
- Server timestamp/order always wins.
- Move rejected if:
  - piece is not owned by caller
  - cooldown not expired
  - illegal move shape/path
  - resulting own-king self-check
  - game not active

Response `200`:
```json
{
  "accepted": true,
  "version": 18,
  "serverReceivedAtMs": 1760000010212,
  "statePatch": { "...": "minimal patch or full snapshot" }
}
```

Error `409` example:
```json
{
  "accepted": false,
  "reason": "COOLDOWN_ACTIVE",
  "serverReceivedAtMs": 1760000010212,
  "currentVersion": 18
}
```

## 5) Resign
`POST /api/games/:gameId/resign`

Response `200`:
```json
{
  "status": "FINISHED",
  "winner": "black",
  "finishReason": "RESIGN"
}
```

## Realtime events on `game:{gameId}`
- `player.joined`
- `state.updated`
- `player.disconnected`
- `player.reconnected`
- `game.finished`
- `game.discarded`

Event payloads include `gameId`, `version`, `serverEventAtMs`.
