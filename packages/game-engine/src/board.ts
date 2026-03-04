import type {
  BoardSetupRequest,
  BoardState,
  Piece,
  PiecePlacement,
  Side,
  PieceType
} from '@realtimechess/shared-types';
import { isValidSquare } from './squares';

function buildPieceId(side: Side, type: PieceType, square: string, index: number): string {
  return `${side}_${type}_${square}_${index}`;
}

function normalizeCustomPieces(pieces: PiecePlacement[]): Piece[] {
  const usedIds = new Set<string>();
  const usedSquares = new Set<string>();

  return pieces.map((piece, index) => {
    if (!isValidSquare(piece.square)) {
      throw new Error(`Invalid square: ${piece.square}`);
    }

    if (usedSquares.has(piece.square)) {
      throw new Error(`Duplicate square in custom board: ${piece.square}`);
    }

    usedSquares.add(piece.square);

    const id = piece.id?.trim() || buildPieceId(piece.side, piece.type, piece.square, index);
    if (usedIds.has(id)) {
      throw new Error(`Duplicate piece id in custom board: ${id}`);
    }

    usedIds.add(id);

    return {
      id,
      side: piece.side,
      type: piece.type,
      square: piece.square
    };
  });
}

function classicBackRank(side: Side, rank: '1' | '8'): Piece[] {
  const order: PieceType[] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook'
  ];

  return order.map((type, index) => {
    const file = String.fromCharCode(97 + index);
    const square = `${file}${rank}`;

    return {
      id: `${side}_${type}_${square}`,
      side,
      type,
      square: square as Piece['square']
    };
  });
}

function classicPawns(side: Side, rank: '2' | '7'): Piece[] {
  return 'abcdefgh'.split('').map((file) => {
    const square = `${file}${rank}`;

    return {
      id: `${side}_pawn_${square}`,
      side,
      type: 'pawn',
      square: square as Piece['square']
    };
  });
}

export function createClassicBoard(): BoardState {
  const pieces: Piece[] = [
    ...classicBackRank('white', '1'),
    ...classicPawns('white', '2'),
    ...classicPawns('black', '7'),
    ...classicBackRank('black', '8')
  ];

  return { pieces };
}

export function createCustomBoard(pieces: PiecePlacement[]): BoardState {
  return {
    pieces: normalizeCustomPieces(pieces)
  };
}

export function createBoardFromSetup(setup?: BoardSetupRequest): BoardState {
  if (!setup || setup.kind === 'classic') {
    return createClassicBoard();
  }

  return createCustomBoard(setup.pieces);
}
