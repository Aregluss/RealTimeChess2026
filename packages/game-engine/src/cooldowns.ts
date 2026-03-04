import type { BoardState, PieceType } from '@realtimechess/shared-types';

export function initializeCooldowns(
  board: BoardState,
  cooldownByType: Record<PieceType, number>
): Record<string, number> {
  const cooldowns: Record<string, number> = {};

  for (const piece of board.pieces) {
    cooldowns[piece.id] = 0;
    if (typeof cooldownByType[piece.type] !== 'number') {
      throw new Error(`Missing cooldown config for piece type ${piece.type}`);
    }
  }

  return cooldowns;
}
