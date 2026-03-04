import {
  createBoardFromSetup,
  hasAnyLegalMove,
  initializeCooldowns,
  isKingInCheck,
  validateAndApplyMove
} from '@realtimechess/game-engine';
import {
  DEFAULT_PIECE_COOLDOWN_MS,
  GAME_TIMERS_MS,
  type CreateGameRequest,
  type CreateGameResponse,
  type GameState,
  type JoinGameRequest,
  type JoinGameResponse,
  type MoveRequest,
  type MoveResponse,
  type Side
} from '@realtimechess/shared-types';
import { AppError } from './errors';
import { pseudoHash } from './hash';

type GameRecord = {
  gameId: string;
  joinCode: string;
  joinExpiresAtMs: number;
  whiteToken: string;
  blackToken: string | null;
  state: GameState;
};

const gamesById = new Map<string, GameRecord>();

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateJoinCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function pruneExpiredGames(nowMs: number): void {
  for (const [gameId, record] of gamesById) {
    const state = record.state;

    if (state.status === 'LOBBY_WAITING' && nowMs > record.joinExpiresAtMs) {
      gamesById.delete(gameId);
      continue;
    }

    if (state.status === 'FINISHED') {
      if (
        state.finishedAtServerMs &&
        nowMs - state.finishedAtServerMs > GAME_TIMERS_MS.FINISHED_DISCARD
      ) {
        gamesById.delete(gameId);
      }
      continue;
    }

    if (nowMs - state.lastStateChangeAtServerMs > GAME_TIMERS_MS.INACTIVITY_DISCARD) {
      gamesById.delete(gameId);
    }
  }
}

function getSideForToken(record: GameRecord, token: string): Side | null {
  if (record.whiteToken === token) {
    return 'white';
  }

  if (record.blackToken === token) {
    return 'black';
  }

  return null;
}

function updateCheckStateAndTerminals(state: GameState, nowMs: number): void {
  const whiteInCheck = isKingInCheck(state.board, 'white');
  const blackInCheck = isKingInCheck(state.board, 'black');

  if (whiteInCheck) {
    if (!state.checkTimers.whiteInCheckSinceMs) {
      state.checkTimers.whiteInCheckSinceMs = nowMs;
    }
    if (nowMs - state.checkTimers.whiteInCheckSinceMs >= GAME_TIMERS_MS.CHECK_TIMEOUT) {
      state.status = 'FINISHED';
      state.winner = 'black';
      state.finishReason = 'CHECK_TIMEOUT';
      state.finishedAtServerMs = nowMs;
      return;
    }
  } else {
    state.checkTimers.whiteInCheckSinceMs = null;
  }

  if (blackInCheck) {
    if (!state.checkTimers.blackInCheckSinceMs) {
      state.checkTimers.blackInCheckSinceMs = nowMs;
    }
    if (nowMs - state.checkTimers.blackInCheckSinceMs >= GAME_TIMERS_MS.CHECK_TIMEOUT) {
      state.status = 'FINISHED';
      state.winner = 'white';
      state.finishReason = 'CHECK_TIMEOUT';
      state.finishedAtServerMs = nowMs;
      return;
    }
  } else {
    state.checkTimers.blackInCheckSinceMs = null;
  }

  // Optional fallback: if a side has no legal moves and is in check, close as timeout-like loss.
  // This preserves progress even before full checkmate/stalemate policy is added.
  if (whiteInCheck && !hasAnyLegalMove(state.board, 'white')) {
    state.status = 'FINISHED';
    state.winner = 'black';
    state.finishReason = 'NO_ESCAPE';
    state.finishedAtServerMs = nowMs;
    return;
  }

  if (blackInCheck && !hasAnyLegalMove(state.board, 'black')) {
    state.status = 'FINISHED';
    state.winner = 'white';
    state.finishReason = 'NO_ESCAPE';
    state.finishedAtServerMs = nowMs;
  }
}

export function createGame(input: unknown): CreateGameResponse {
  const nowMs = Date.now();
  pruneExpiredGames(nowMs);

  const request = (input ?? {}) as CreateGameRequest;
  const gameId = generateId('g');
  const whiteToken = generateId('pt');
  const board = createBoardFromSetup(request.boardSetup);

  const state: GameState = {
    gameId,
    status: 'LOBBY_WAITING',
    version: 1,
    createdAtServerMs: nowMs,
    lastStateChangeAtServerMs: nowMs,
    lastMoveAtServerMs: null,
    finishedAtServerMs: null,
    winner: null,
    finishReason: null,
    board,
    cooldowns: initializeCooldowns(board, DEFAULT_PIECE_COOLDOWN_MS),
    checkTimers: {
      whiteInCheckSinceMs: null,
      blackInCheckSinceMs: null
    },
    players: {
      white: {
        tokenHash: pseudoHash(whiteToken),
        connected: true,
        disconnectedSinceMs: null
      },
      black: null
    }
  };

  const joinCode = generateJoinCode();
  const joinExpiresAtMs = nowMs + GAME_TIMERS_MS.JOIN_CODE_TTL;

  gamesById.set(gameId, {
    gameId,
    joinCode,
    joinExpiresAtMs,
    whiteToken,
    blackToken: null,
    state
  });

  return {
    gameId,
    joinCode,
    joinExpiresAtMs,
    joinLink: `/join?gameId=${gameId}&code=${joinCode}`,
    playerToken: whiteToken,
    side: 'white',
    state,
    config: {
      timersMs: GAME_TIMERS_MS,
      pieceCooldownMs: DEFAULT_PIECE_COOLDOWN_MS
    }
  };
}

export function joinGame(input: unknown): JoinGameResponse {
  const nowMs = Date.now();
  pruneExpiredGames(nowMs);

  const request = (input ?? {}) as JoinGameRequest;
  if (!request.gameId || !request.joinCode) {
    throw new AppError(400, 'gameId and joinCode are required');
  }

  const record = gamesById.get(request.gameId);
  if (!record) {
    throw new AppError(404, 'Game not found');
  }

  if (nowMs > record.joinExpiresAtMs) {
    gamesById.delete(request.gameId);
    throw new AppError(410, 'Join code expired');
  }

  if (record.state.players.black) {
    throw new AppError(409, 'Game already has 2 players');
  }

  if (record.joinCode !== request.joinCode) {
    throw new AppError(401, 'Invalid join code');
  }

  const blackToken = generateId('pt');
  record.blackToken = blackToken;
  record.state.players.black = {
    tokenHash: pseudoHash(blackToken),
    connected: true,
    disconnectedSinceMs: null
  };
  record.state.status = 'ACTIVE';
  record.state.lastStateChangeAtServerMs = nowMs;
  record.state.version += 1;

  return {
    gameId: request.gameId,
    playerToken: blackToken,
    side: 'black',
    state: record.state
  };
}

export function getGameState(gameId: string): GameState {
  const nowMs = Date.now();
  pruneExpiredGames(nowMs);

  const record = gamesById.get(gameId);
  if (!record) {
    throw new AppError(404, 'Game not found');
  }

  if (record.state.status === 'ACTIVE') {
    updateCheckStateAndTerminals(record.state, nowMs);
  }

  return record.state;
}

export function submitMove(gameId: string, input: unknown, authToken?: string): MoveResponse {
  const nowMs = Date.now();
  pruneExpiredGames(nowMs);

  const request = (input ?? {}) as MoveRequest;
  const token = authToken ?? request.playerToken;

  if (!token) {
    throw new AppError(401, 'Missing player token');
  }

  if (!request.pieceId || !request.to) {
    throw new AppError(400, 'pieceId and to are required');
  }

  const record = gamesById.get(gameId);
  if (!record) {
    throw new AppError(404, 'Game not found');
  }

  const side = getSideForToken(record, token);
  if (!side) {
    throw new AppError(403, 'Token does not match a player in this game');
  }

  if (record.state.status !== 'ACTIVE') {
    throw new AppError(409, `Game is not active: ${record.state.status}`);
  }

  if (
    typeof request.expectedVersion === 'number' &&
    request.expectedVersion !== record.state.version
  ) {
    throw new AppError(409, `Version mismatch. Current version: ${record.state.version}`);
  }

  const cooldownUntil = record.state.cooldowns[request.pieceId] ?? 0;
  if (nowMs < cooldownUntil) {
    throw new AppError(409, `COOLDOWN_ACTIVE until ${cooldownUntil}`);
  }

  const moveResult = validateAndApplyMove({
    board: record.state.board,
    side,
    pieceId: request.pieceId,
    to: request.to
  });

  if (!moveResult.ok) {
    throw new AppError(409, moveResult.reason);
  }

  record.state.board = moveResult.board;
  record.state.lastMoveAtServerMs = nowMs;
  record.state.lastStateChangeAtServerMs = nowMs;
  record.state.version += 1;

  const movedPiece = moveResult.movedPiece;
  record.state.cooldowns[movedPiece.id] = nowMs + DEFAULT_PIECE_COOLDOWN_MS[movedPiece.type];

  updateCheckStateAndTerminals(record.state, nowMs);

  return {
    accepted: true,
    version: record.state.version,
    serverReceivedAtMs: nowMs,
    state: record.state
  };
}
