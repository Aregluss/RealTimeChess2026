import type { Square } from '@realtimechess/shared-types';

const squarePattern = /^[a-h][1-8]$/;

export function isValidSquare(value: string): value is Square {
  return squarePattern.test(value);
}
