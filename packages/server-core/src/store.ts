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
const MOVE_LOG_ENABLED = process.env.RTC_MOVE_LOGS !== '0';

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

function normalizeSquare(value: string, field: 'from' | 'to'): string {
  const normalized = value.toLowerCase();
  if (!SQUARE_RE.test(normalized)) {
    throw new AppError(400, `Invalid ${field} square`);
  }

  return normalized;
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

async function compareAndSwapRecord(
  record: GameRecord,
  expectedVersion: number,
  nowMs: number
): Promise<boolean> {
  return storage.compareAndSwapGameRecord(
    record.gameId,
    expectedVersion,
    record,
    ttlMsForRecord(record, nowMs)
  );
}

async function deleteRecord(record: GameRecord): Promise<void> {
  await storage.deleteGameRecord(record.gameId);
  await storage.deleteJoinCode(record.joinCode);
}

function logMoveEvent(event: string, payload: Record<string, unknown>): void {
  if (!MOVE_LOG_ENABLED) {
    return;
  }

  console.info(`[rtc.move.${event}] ${JSON.stringify(payload)}`);
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
    if (state.checkTimers.whiteInCheckSinceMs === null) {
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
    if (state.checkTimers.blackInCheckSinceMs === null) {
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

function updateCheckTimeoutTerminalOnly(state: GameState, nowMs: number): boolean {
  if (state.status !== 'ACTIVE') {
    return false;
  }

  if (
    state.checkState.whiteInCheck &&
    state.checkTimers.whiteInCheckSinceMs !== null &&
    nowMs - state.checkTimers.whiteInCheckSinceMs >= state.rules.checkTimeoutMs
  ) {
    state.status = 'FINISHED';
    state.winner = 'black';
    state.finishReason = 'CHECK_TIMEOUT';
    state.finishedAtServerMs = nowMs;
    return true;
  }

  if (
    state.checkState.blackInCheck &&
    state.checkTimers.blackInCheckSinceMs !== null &&
    nowMs - state.checkTimers.blackInCheckSinceMs >= state.rules.checkTimeoutMs
  ) {
    state.status = 'FINISHED';
    state.winner = 'white';
    state.finishReason = 'CHECK_TIMEOUT';
    state.finishedAtServerMs = nowMs;
    return true;
  }

  return false;
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
    joinLink: `/invite/${gameId}/${joinCode}`,
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
  const request = (input ?? {}) as JoinGameRequest;

  if (!request.gameId || !request.joinCode) {
    throw new AppError(400, 'gameId and joinCode are required');
  }
  assertGameId(request.gameId);
  assertJoinCode(request.joinCode);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const nowMs = Date.now();
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
    const currentVersion = record.state.version;

    record.blackToken = blackToken;
    record.state.players.black = {
      connected: true,
      disconnectedSinceMs: null
    };
    record.state.status = 'ACTIVE';
    record.state.lastStateChangeAtServerMs = nowMs;
    record.state.version = currentVersion + 1;

    const saved = await compareAndSwapRecord(record, currentVersion, nowMs);
    if (!saved) {
      continue;
    }

    await storage.deleteJoinCode(record.joinCode);
    await emitStateEvent('player.joined', record.state);

    return {
      gameId: request.gameId,
      playerToken: blackToken,
      side: 'black',
      state: record.state
    };
  }

  throw new AppError(409, 'Join conflict, please retry');
}

export async function getGameState(gameId: string): Promise<GameState> {
  assertGameId(gameId);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const nowMs = Date.now();
    const record = await getRequiredRecord(gameId);

    const currentVersion = record.state.version;
    const timedOut = updateCheckTimeoutTerminalOnly(record.state, nowMs);
    if (!timedOut) {
      return record.state;
    }

    record.state.lastStateChangeAtServerMs = nowMs;
    record.state.version = currentVersion + 1;
    const saved = await compareAndSwapRecord(record, currentVersion, nowMs);
    if (!saved) {
      continue;
    }

    logMoveEvent('state_timeout_finish', {
      gameId,
      attempt,
      version: record.state.version,
      winner: record.state.winner,
      finishReason: record.state.finishReason
    });
    await emitStateEvent(eventTypeForState(record.state), record.state);
    return record.state;
  }

  throw new AppError(409, 'State conflict, retry');
}

export async function submitMove(
  gameId: string,
  input: unknown,
  authToken?: string
): Promise<MoveResponse> {
  const request = (input ?? {}) as MoveRequest;
  const token = authToken ?? request.playerToken;
  const requestId = generateId('mv');
  const requestStartedAtMs = Date.now();

  if (!token) {
    throw new AppError(401, 'Missing player token');
  }

  if (!request.pieceId || !request.from || !request.to) {
    throw new AppError(400, 'pieceId, from, and to are required');
  }
  assertGameId(gameId);
  assertPieceId(request.pieceId);
  const fromSquare = normalizeSquare(request.from, 'from');
  const toSquare = normalizeSquare(request.to, 'to');
  const expectedVersion =
    typeof request.expectedVersion === 'number' && Number.isFinite(request.expectedVersion)
      ? Math.floor(request.expectedVersion)
      : null;

  logMoveEvent('received', {
    requestId,
    gameId,
    pieceId: request.pieceId,
    from: fromSquare,
    to: toSquare,
    expectedVersion
  });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const attemptStartedAtMs = Date.now();
    const record = await getRequiredRecord(gameId);
    const currentVersion = record.state.version;
    const side = getSideForToken(record, token);

    if (!side) {
      const reason = 'Token does not match a player in this game';
      logMoveEvent('rejected', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        reason
      });
      throw new AppError(403, reason);
    }

    if (record.state.status !== 'ACTIVE') {
      const reason = `Game is not active: ${record.state.status}`;
      logMoveEvent('rejected', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        reason
      });
      throw new AppError(409, reason);
    }

    const pieceAtFrom = record.state.board.pieces.find((piece) => piece.id === request.pieceId);
    if (!pieceAtFrom) {
      logMoveEvent('rejected', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        reason: 'PIECE_NOT_FOUND'
      });
      throw new AppError(409, 'PIECE_NOT_FOUND');
    }

    if (pieceAtFrom.square !== fromSquare) {
      logMoveEvent('rejected', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        reason: 'PIECE_POSITION_CHANGED',
        actualFrom: pieceAtFrom.square
      });
      throw new AppError(409, `PIECE_POSITION_CHANGED current=${pieceAtFrom.square}`);
    }

    const nowMs = Date.now();
    const cooldownUntil = record.state.cooldowns[request.pieceId] ?? 0;
    if (nowMs < cooldownUntil) {
      logMoveEvent('rejected', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        reason: 'COOLDOWN_ACTIVE',
        cooldownUntil
      });
      throw new AppError(409, `COOLDOWN_ACTIVE until ${cooldownUntil}`);
    }

    const validateStartedAtMs = Date.now();
    const moveResult = validateAndApplyMove({
      board: record.state.board,
      side,
      pieceId: request.pieceId,
      to: toSquare,
      pieceHasMoved: record.state.pieceHasMoved
    });
    const validateMs = Date.now() - validateStartedAtMs;

    if (!moveResult.ok) {
      logMoveEvent('rejected', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        reason: moveResult.reason,
        validateMs
      });
      throw new AppError(409, moveResult.reason);
    }

    record.state.board = moveResult.board;
    record.state.lastMoveAtServerMs = nowMs;
    record.state.lastStateChangeAtServerMs = nowMs;
    record.state.version = currentVersion + 1;

    for (const pieceId of moveResult.touchedPieceIds) {
      record.state.pieceHasMoved[pieceId] = true;
      const movedPieceRef = record.state.board.pieces.find((piece) => piece.id === pieceId);
      if (movedPieceRef) {
        record.state.cooldowns[pieceId] =
          nowMs + record.state.rules.pieceCooldownMs[movedPieceRef.type];
      }
    }

    updateCheckStateAndTerminals(record.state, nowMs);

    const writeStartedAtMs = Date.now();
    const saved = await compareAndSwapRecord(record, currentVersion, nowMs);
    const writeMs = Date.now() - writeStartedAtMs;
    if (!saved) {
      logMoveEvent('cas_conflict', {
        requestId,
        gameId,
        attempt,
        currentVersion,
        expectedVersion,
        validateMs,
        writeMs
      });
      continue;
    }

    const publishStartedAtMs = Date.now();
    await emitStateEvent(eventTypeForState(record.state), record.state);
    const publishMs = Date.now() - publishStartedAtMs;
    const totalMs = Date.now() - requestStartedAtMs;
    const attemptMs = Date.now() - attemptStartedAtMs;

    logMoveEvent('committed', {
      requestId,
      gameId,
      attempt,
      side,
      pieceId: request.pieceId,
      from: fromSquare,
      to: toSquare,
      expectedVersion,
      previousVersion: currentVersion,
      committedVersion: record.state.version,
      versionSkew:
        typeof expectedVersion === 'number' ? currentVersion - expectedVersion : null,
      validateMs,
      writeMs,
      publishMs,
      attemptMs,
      totalMs,
      status: record.state.status
    });

    return {
      accepted: true,
      version: record.state.version,
      serverReceivedAtMs: requestStartedAtMs,
      state: record.state
    };
  }

  logMoveEvent('rejected', {
    requestId,
    gameId,
    reason: 'STATE_CONFLICT_RETRY_EXHAUSTED'
  });
  throw new AppError(409, 'STATE_CONFLICT_RETRY_EXHAUSTED');
}
