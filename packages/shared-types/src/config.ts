import type { PieceType } from './chess';

export const GAME_TIMERS_MS = {
  JOIN_CODE_TTL: 120_000,
  INACTIVITY_DISCARD: 60_000,
  FINISHED_DISCARD: 60_000,
  DISCONNECT_GRACE: 15_000,
  CHECK_TIMEOUT: 2_000
} as const;

export const DEFAULT_PIECE_COOLDOWN_MS: Record<PieceType, number> = {
  king: 100,
  queen: 1_000,
  rook: 1_000,
  bishop: 1_000,
  knight: 1_000,
  pawn: 1_000
};
