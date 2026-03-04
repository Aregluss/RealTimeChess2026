import type { BoardState, Piece, Side, Square } from '@realtimechess/shared-types';
import { coordToSquare, isOnBoard, squareToCoord } from './coords';

export type MoveValidationResult =
  | { ok: true; board: BoardState; movedPiece: Piece }
  | { ok: false; reason: string };

function pieceAt(board: BoardState, square: Square): Piece | undefined {
  return board.pieces.find((piece) => piece.square === square);
}

function isPathClear(board: BoardState, from: Square, to: Square): boolean {
  const fromCoord = squareToCoord(from);
  const toCoord = squareToCoord(to);

  const deltaFile = Math.sign(toCoord.file - fromCoord.file);
  const deltaRank = Math.sign(toCoord.rank - fromCoord.rank);

  let file = fromCoord.file + deltaFile;
  let rank = fromCoord.rank + deltaRank;

  while (file !== toCoord.file || rank !== toCoord.rank) {
    const square = coordToSquare(file, rank);
    if (pieceAt(board, square)) {
      return false;
    }
    file += deltaFile;
    rank += deltaRank;
  }

  return true;
}

function canAttackSquare(piece: Piece, board: BoardState, target: Square): boolean {
  const from = squareToCoord(piece.square);
  const to = squareToCoord(target);
  const df = to.file - from.file;
  const dr = to.rank - from.rank;
  const absDf = Math.abs(df);
  const absDr = Math.abs(dr);

  switch (piece.type) {
    case 'pawn': {
      const dir = piece.side === 'white' ? 1 : -1;
      return dr === dir && absDf === 1;
    }
    case 'knight':
      return (absDf === 1 && absDr === 2) || (absDf === 2 && absDr === 1);
    case 'bishop':
      return absDf === absDr && isPathClear(board, piece.square, target);
    case 'rook':
      return (df === 0 || dr === 0) && isPathClear(board, piece.square, target);
    case 'queen':
      return (absDf === absDr || df === 0 || dr === 0) && isPathClear(board, piece.square, target);
    case 'king':
      return absDf <= 1 && absDr <= 1;
    default:
      return false;
  }
}

function isMovePatternLegal(piece: Piece, board: BoardState, to: Square): boolean {
  const from = squareToCoord(piece.square);
  const target = squareToCoord(to);
  const df = target.file - from.file;
  const dr = target.rank - from.rank;
  const absDf = Math.abs(df);
  const absDr = Math.abs(dr);
  const targetPiece = pieceAt(board, to);

  if (targetPiece?.side === piece.side) {
    return false;
  }

  switch (piece.type) {
    case 'pawn': {
      const dir = piece.side === 'white' ? 1 : -1;
      const startRank = piece.side === 'white' ? 1 : 6;

      if (df === 0 && dr === dir && !targetPiece) {
        return true;
      }

      if (df === 0 && dr === 2 * dir && from.rank === startRank && !targetPiece) {
        const intermediate = coordToSquare(from.file, from.rank + dir);
        return !pieceAt(board, intermediate);
      }

      if (absDf === 1 && dr === dir && targetPiece && targetPiece.side !== piece.side) {
        return true;
      }

      return false;
    }
    case 'knight':
      return (absDf === 1 && absDr === 2) || (absDf === 2 && absDr === 1);
    case 'bishop':
      return absDf === absDr && isPathClear(board, piece.square, to);
    case 'rook':
      return (df === 0 || dr === 0) && isPathClear(board, piece.square, to);
    case 'queen':
      return (absDf === absDr || df === 0 || dr === 0) && isPathClear(board, piece.square, to);
    case 'king':
      return absDf <= 1 && absDr <= 1;
    default:
      return false;
  }
}

function applyMove(board: BoardState, piece: Piece, to: Square): BoardState {
  const piecesWithoutCaptured = board.pieces.filter(
    (candidate) => candidate.square !== to || candidate.id === piece.id
  );

  const promotedType =
    piece.type === 'pawn' && ((piece.side === 'white' && to.endsWith('8')) || (piece.side === 'black' && to.endsWith('1')))
      ? 'queen'
      : piece.type;

  const moved: Piece = {
    ...piece,
    type: promotedType,
    square: to
  };

  return {
    pieces: piecesWithoutCaptured.map((candidate) =>
      candidate.id === piece.id ? moved : candidate
    )
  };
}

export function isKingInCheck(board: BoardState, side: Side): boolean {
  const king = board.pieces.find((piece) => piece.side === side && piece.type === 'king');
  if (!king) {
    return false;
  }

  const opponent: Side = side === 'white' ? 'black' : 'white';
  return board.pieces
    .filter((piece) => piece.side === opponent)
    .some((piece) => canAttackSquare(piece, board, king.square));
}

export function validateAndApplyMove(args: {
  board: BoardState;
  side: Side;
  pieceId: string;
  to: string;
}): MoveValidationResult {
  const { board, side, pieceId, to } = args;

  const toLower = to.toLowerCase();
  if (!/^[a-h][1-8]$/.test(toLower)) {
    return { ok: false, reason: 'INVALID_TARGET_SQUARE' };
  }

  const targetSquare = toLower as Square;

  const piece = board.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return { ok: false, reason: 'PIECE_NOT_FOUND' };
  }

  if (piece.side !== side) {
    return { ok: false, reason: 'NOT_YOUR_PIECE' };
  }

  if (piece.square === targetSquare) {
    return { ok: false, reason: 'NO_OP_MOVE' };
  }

  if (!isMovePatternLegal(piece, board, targetSquare)) {
    return { ok: false, reason: 'ILLEGAL_MOVE_PATTERN' };
  }

  const nextBoard = applyMove(board, piece, targetSquare);

  if (isKingInCheck(nextBoard, side)) {
    return { ok: false, reason: 'SELF_CHECK' };
  }

  const movedPiece = nextBoard.pieces.find((candidate) => candidate.id === piece.id);
  if (!movedPiece) {
    return { ok: false, reason: 'INTERNAL_MOVE_ERROR' };
  }

  return {
    ok: true,
    board: nextBoard,
    movedPiece
  };
}

export function hasAnyLegalMove(board: BoardState, side: Side): boolean {
  const ownPieces = board.pieces.filter((piece) => piece.side === side);

  for (const piece of ownPieces) {
    for (let file = 0; file < 8; file += 1) {
      for (let rank = 0; rank < 8; rank += 1) {
        if (!isOnBoard(file, rank)) {
          continue;
        }
        const target = coordToSquare(file, rank);
        const result = validateAndApplyMove({ board, side, pieceId: piece.id, to: target });
        if (result.ok) {
          return true;
        }
      }
    }
  }

  return false;
}
