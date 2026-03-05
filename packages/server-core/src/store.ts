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
  type GameEventPayload,
  type GameState,
  type JoinGameRequest,
  type JoinGameResponse,
  type MoveRequest,
  type MoveResponse,
  type Side
} from '@realtimechess/shared-types';
import { randomBytes, randomInt } from 'node:crypto';
import { AppError } from './errors';
import { publishGameEvent } from './realtime';
import { storage, type GameRecord } from './storage';

const GAME_ID_RE = /^g_[a-z0-9]{8}$/;
const JOIN_CODE_RE = /^\d{6}$/;
const SQUARE_RE = /^[a-h][1-8]$/;

function generateId(prefix: string): string {
  if (prefix === 'g') {
    const suffix = randomInt(0, 36 ** 8).toString(36).padStart(8, '0');
    return `${prefix}_${suffix}`;
  }

  return `${prefix}_${randomBytes(18).toString('base64url')}`;
}

function generateJoinCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function resolveCheckTimeoutMs(requested?: number): number {
  if (typeof requested !== 'number' || Number.isNaN(requested)) {
    return GAME_TIMERS_MS.CHECK_TIMEOUT;
  }

  return Math.min(30_000, Math.max(500, Math.floor(requested)));
}

function assertGameId(value: string): void {
  if (!GAME_ID_RE.test(value)) {
    throw new AppError(400, 'Invalid gameId format');
  }
}

function assertJoinCode(value: string): void {
  if (!JOIN_CODE_RE.test(value)) {
    throw new AppError(400, 'Invalid join code format');
  }
}

function assertPieceId(value: string): void {
  if (typeof value !== 'string') {
    throw new AppError(400, 'Invalid pieceId');
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) {
    throw new AppError(400, 'Invalid pieceId length');
  }
}

function assertTargetSquare(value: string): void {
  if (!SQUARE_RE.test(value.toLowerCase())) {
    throw new AppError(400, 'Invalid target square');
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

function ttlMsForRecord(record: GameRecord, nowMs: number): number {
  const state = record.state;

  if (state.status === 'LOBBY_WAITING') {
    return Math.max(1_000, record.joinExpiresAtMs - nowMs);
  }

  if (state.status === 'FINISHED') {
    return GAME_TIMERS_MS.FINISHED_DISCARD;
  }

  return GAME_TIMERS_MS.INACTIVITY_DISCARD;
}

async function saveRecord(record: GameRecord, nowMs: number): Promise<void> {
  await storage.setGameRecord(record, ttlMsForRecord(record, nowMs));
}

async function deleteRecord(record: GameRecord): Promise<void> {
  await storage.deleteGameRecord(record.gameId);
  await storage.deleteJoinCode(record.joinCode);
}

async function emitStateEvent(type: GameEventPayload['type'], state: GameState): Promise<void> {
  const payload: GameEventPayload = {
    type,
    gameId: state.gameId,
    version: state.version,
    state,
    serverEventAtMs: Date.now()
  };

  await publishGameEvent(payload);
}

function eventTypeForState(state: GameState): GameEventPayload['type'] {
  return state.status === 'FINISHED' ? 'game.finished' : 'state.updated';
}

function updateCheckStateAndTerminals(state: GameState, nowMs: number): boolean {
  let changed = false;
  const whiteKingAlive = state.board.pieces.some(
    (piece) => piece.side === 'white' && piece.type === 'king'
  );
  const blackKingAlive = state.board.pieces.some(
    (piece) => piece.side === 'black' && piece.type === 'king'
  );

  if (!whiteKingAlive && blackKingAlive) {
    state.status = 'FINISHED';
    state.winner = 'black';
    state.finishReason = 'KING_CAPTURE';
    state.finishedAtServerMs = nowMs;
    return true;
  }

  if (!blackKingAlive && whiteKingAlive) {
    state.status = 'FINISHED';
    state.winner = 'white';
    state.finishReason = 'KING_CAPTURE';
    state.finishedAtServerMs = nowMs;
    return true;
  }

  const whiteInCheck = isKingInCheck(state.board, 'white');
  const blackInCheck = isKingInCheck(state.board, 'black');

  if (state.checkState.whiteInCheck !== whiteInCheck) {
    state.checkState.whiteInCheck = whiteInCheck;
    changed = true;
  }

  if (state.checkState.blackInCheck !== blackInCheck) {
    state.checkState.blackInCheck = blackInCheck;
    changed = true;
  }

  if (whiteInCheck) {
    if (!state.checkTimers.whiteInCheckSinceMs) {
      state.checkTimers.whiteInCheckSinceMs = nowMs;
      changed = true;
    }
    if (nowMs - state.checkTimers.whiteInCheckSinceMs >= state.rules.checkTimeoutMs) {
      state.status = 'FINISHED';
      state.winner = 'black';
      state.finishReason = 'CHECK_TIMEOUT';
      state.finishedAtServerMs = nowMs;
      changed = true;
      return changed;
    }
  } else if (state.checkTimers.whiteInCheckSinceMs !== null) {
    state.checkTimers.whiteInCheckSinceMs = null;
    changed = true;
  }

  if (blackInCheck) {
    if (!state.checkTimers.blackInCheckSinceMs) {
      state.checkTimers.blackInCheckSinceMs = nowMs;
      changed = true;
    }
    if (nowMs - state.checkTimers.blackInCheckSinceMs >= state.rules.checkTimeoutMs) {
      state.status = 'FINISHED';
      state.winner = 'white';
      state.finishReason = 'CHECK_TIMEOUT';
      state.finishedAtServerMs = nowMs;
      changed = true;
      return changed;
    }
  } else if (state.checkTimers.blackInCheckSinceMs !== null) {
    state.checkTimers.blackInCheckSinceMs = null;
    changed = true;
  }

  if (whiteInCheck && !hasAnyLegalMove(state.board, 'white', state.pieceHasMoved)) {
    state.status = 'FINISHED';
    state.winner = 'black';
    state.finishReason = 'NO_ESCAPE';
    state.finishedAtServerMs = nowMs;
    changed = true;
    return changed;
  }

  if (blackInCheck && !hasAnyLegalMove(state.board, 'black', state.pieceHasMoved)) {
    state.status = 'FINISHED';
    state.winner = 'white';
    state.finishReason = 'NO_ESCAPE';
    state.finishedAtServerMs = nowMs;
    changed = true;
  }

  return changed;
}

async function getRequiredRecord(gameId: string): Promise<GameRecord> {
  const record = await storage.getGameRecord(gameId);
  if (!record) {
    throw new AppError(404, 'Game not found');
  }

  return record;
}

export async function createGame(input: unknown): Promise<CreateGameResponse> {
  const nowMs = Date.now();
  const request = (input ?? {}) as CreateGameRequest;
  if (request.boardSetup?.kind === 'custom' && request.boardSetup.pieces.length > 64) {
    throw new AppError(400, 'Custom board has too many pieces');
  }

  const gameId = generateId('g');
  const whiteToken = generateId('pt');
  const board = createBoardFromSetup(request.boardSetup);
  const checkTimeoutMs = resolveCheckTimeoutMs(request.checkTimeoutMs);

  const pieceHasMoved: Record<string, boolean> = {};
  for (const piece of board.pieces) {
    pieceHasMoved[piece.id] = false;
  }

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
    checkState: {
      whiteInCheck: false,
      blackInCheck: false
    },
    pieceHasMoved,
    rules: {
      checkTimeoutMs,
      pieceCooldownMs: DEFAULT_PIECE_COOLDOWN_MS
    },
    players: {
      white: {
        connected: true,
        disconnectedSinceMs: null
      },
      black: null
    }
  };

  const joinCode = generateJoinCode();
  const joinExpiresAtMs = nowMs + GAME_TIMERS_MS.JOIN_CODE_TTL;

  const record: GameRecord = {
    gameId,
    joinCode,
    joinExpiresAtMs,
    whiteToken,
    blackToken: null,
    state
  };

  await saveRecord(record, nowMs);
  await storage.setJoinCode(joinCode, { gameId }, GAME_TIMERS_MS.JOIN_CODE_TTL);
  await emitStateEvent('game.created', state);

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

export async function joinGame(input: unknown): Promise<JoinGameResponse> {
  const nowMs = Date.now();
  const request = (input ?? {}) as JoinGameRequest;

  if (!request.gameId || !request.joinCode) {
    throw new AppError(400, 'gameId and joinCode are required');
  }
  assertGameId(request.gameId);
  assertJoinCode(request.joinCode);

  const record = await getRequiredRecord(request.gameId);

  if (nowMs > record.joinExpiresAtMs) {
    await deleteRecord(record);
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
    connected: true,
    disconnectedSinceMs: null
  };
  record.state.status = 'ACTIVE';
  record.state.lastStateChangeAtServerMs = nowMs;
  record.state.version += 1;

  await saveRecord(record, nowMs);
  await storage.deleteJoinCode(record.joinCode);
  await emitStateEvent('player.joined', record.state);

  return {
    gameId: request.gameId,
    playerToken: blackToken,
    side: 'black',
    state: record.state
  };
}

export async function getGameState(gameId: string): Promise<GameState> {
  assertGameId(gameId);
  const nowMs = Date.now();
  const record = await getRequiredRecord(gameId);

  if (record.state.status === 'ACTIVE') {
    const changed = updateCheckStateAndTerminals(record.state, nowMs);
    if (changed) {
      await saveRecord(record, nowMs);
      await emitStateEvent(eventTypeForState(record.state), record.state);
    }
  }

  return record.state;
}

export async function submitMove(
  gameId: string,
  input: unknown,
  authToken?: string
): Promise<MoveResponse> {
  const nowMs = Date.now();
  const request = (input ?? {}) as MoveRequest;
  const token = authToken ?? request.playerToken;

  if (!token) {
    throw new AppError(401, 'Missing player token');
  }

  if (!request.pieceId || !request.to) {
    throw new AppError(400, 'pieceId and to are required');
  }
  assertGameId(gameId);
  assertPieceId(request.pieceId);
  assertTargetSquare(request.to);

  const record = await getRequiredRecord(gameId);

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
    to: request.to,
    pieceHasMoved: record.state.pieceHasMoved
  });

  if (!moveResult.ok) {
    throw new AppError(409, moveResult.reason);
  }

  record.state.board = moveResult.board;
  record.state.lastMoveAtServerMs = nowMs;
  record.state.lastStateChangeAtServerMs = nowMs;
  record.state.version += 1;

  for (const pieceId of moveResult.touchedPieceIds) {
    record.state.pieceHasMoved[pieceId] = true;
    const movedPieceRef = record.state.board.pieces.find((piece) => piece.id === pieceId);
    if (movedPieceRef) {
      record.state.cooldowns[pieceId] =
        nowMs + record.state.rules.pieceCooldownMs[movedPieceRef.type];
    }
  }

  updateCheckStateAndTerminals(record.state, nowMs);

  await saveRecord(record, nowMs);
  await emitStateEvent(eventTypeForState(record.state), record.state);

  return {
    accepted: true,
    version: record.state.version,
    serverReceivedAtMs: nowMs,
    state: record.state
  };
}
