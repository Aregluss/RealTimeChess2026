import type { BoardSetupRequest, GameState, Side } from './chess';
import { DEFAULT_PIECE_COOLDOWN_MS, GAME_TIMERS_MS } from './config';

export interface CreateGameRequest {
  boardSetup?: BoardSetupRequest;
}

export interface CreateGameResponse {
  gameId: string;
  joinCode: string;
  joinExpiresAtMs: number;
  joinLink: string;
  playerToken: string;
  side: Side;
  state: GameState;
  config: {
    timersMs: typeof GAME_TIMERS_MS;
    pieceCooldownMs: typeof DEFAULT_PIECE_COOLDOWN_MS;
  };
}

export interface JoinGameRequest {
  gameId: string;
  joinCode: string;
}

export interface JoinGameResponse {
  gameId: string;
  playerToken: string;
  side: Side;
  state: GameState;
}

export interface MoveRequest {
  playerToken?: string;
  pieceId: string;
  to: string;
  expectedVersion?: number;
}

export interface MoveResponse {
  accepted: true;
  version: number;
  serverReceivedAtMs: number;
  state: GameState;
}
