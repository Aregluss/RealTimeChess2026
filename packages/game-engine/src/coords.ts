import type { Square } from '@realtimechess/shared-types';

export type Coord = { file: number; rank: number };

export function squareToCoord(square: Square): Coord {
  return {
    file: square.charCodeAt(0) - 97,
    rank: Number(square[1]) - 1
  };
}

export function coordToSquare(file: number, rank: number): Square {
  return `${String.fromCharCode(97 + file)}${rank + 1}` as Square;
}

export function isOnBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}
