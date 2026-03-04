import type { BoardState, Piece, Side, Square } from '@realtimechess/shared-types';
import { coordToSquare, isOnBoard, squareToCoord } from './coords';

export type MoveValidationResult =
  | { ok: true; board: BoardState; movedPiece: Piece; touchedPieceIds: string[] }
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

export function isSquareUnderAttack(board: BoardState, square: Square, bySide: Side): boolean {
  return board.pieces
    .filter((piece) => piece.side === bySide)
    .some((piece) => canAttackSquare(piece, board, square));
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
    piece.type === 'pawn' &&
    ((piece.side === 'white' && to.endsWith('8')) || (piece.side === 'black' && to.endsWith('1')))
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

function getCastlingRookInfo(king: Piece, to: Square): { rookFrom: Square; rookTo: Square } | null {
  if (king.type !== 'king') {
    return null;
  }

  const rank = king.side === 'white' ? '1' : '8';
  if (king.square !== (`e${rank}` as Square)) {
    return null;
  }

  if (to === (`g${rank}` as Square)) {
    return {
      rookFrom: `h${rank}` as Square,
      rookTo: `f${rank}` as Square
    };
  }

  if (to === (`c${rank}` as Square)) {
    return {
      rookFrom: `a${rank}` as Square,
      rookTo: `d${rank}` as Square
    };
  }

  return null;
}

function applyCastlingMove(board: BoardState, king: Piece, to: Square): { board: BoardState; rookId: string } {
  const castlingInfo = getCastlingRookInfo(king, to);
  if (!castlingInfo) {
    throw new Error('Invalid castling request');
  }

  const rook = pieceAt(board, castlingInfo.rookFrom);
  if (!rook) {
    throw new Error('Missing rook for castling');
  }

  return {
    board: {
      pieces: board.pieces.map((candidate) => {
        if (candidate.id === king.id) {
          return { ...candidate, square: to };
        }

        if (candidate.id === rook.id) {
          return { ...candidate, square: castlingInfo.rookTo };
        }

        return candidate;
      })
    },
    rookId: rook.id
  };
}

function validateCastling(args: {
  board: BoardState;
  side: Side;
  king: Piece;
  to: Square;
  pieceHasMoved: Record<string, boolean>;
}): { ok: true; board: BoardState; movedPiece: Piece; touchedPieceIds: string[] } | { ok: false; reason: string } {
  const { board, side, king, to, pieceHasMoved } = args;

  const castlingInfo = getCastlingRookInfo(king, to);
  if (!castlingInfo) {
    return { ok: false, reason: 'ILLEGAL_CASTLE_TARGET' };
  }

  if (pieceHasMoved[king.id]) {
    return { ok: false, reason: 'KING_ALREADY_MOVED' };
  }

  const rook = pieceAt(board, castlingInfo.rookFrom);
  if (!rook || rook.type !== 'rook' || rook.side !== side) {
    return { ok: false, reason: 'CASTLING_ROOK_NOT_FOUND' };
  }

  if (pieceHasMoved[rook.id]) {
    return { ok: false, reason: 'ROOK_ALREADY_MOVED' };
  }

  const betweenSquares =
    to[0] === 'g'
      ? ([castlingInfo.rookTo, `g${side === 'white' ? '1' : '8'}` as Square] as const)
      : ([`d${side === 'white' ? '1' : '8'}` as Square, `c${side === 'white' ? '1' : '8'}` as Square, `b${side === 'white' ? '1' : '8'}` as Square] as const);

  for (const square of betweenSquares) {
    if (pieceAt(board, square)) {
      return { ok: false, reason: 'CASTLE_PATH_BLOCKED' };
    }
  }

  const opponent = side === 'white' ? 'black' : 'white';
  const kingPassSquares =
    to[0] === 'g'
      ? ([king.square, castlingInfo.rookTo, to] as const)
      : ([king.square, castlingInfo.rookTo, to] as const);

  for (const square of kingPassSquares) {
    if (isSquareUnderAttack(board, square, opponent)) {
      return { ok: false, reason: 'CASTLE_THROUGH_CHECK' };
    }
  }

  const castled = applyCastlingMove(board, king, to);

  const movedKing = castled.board.pieces.find((candidate) => candidate.id === king.id);
  if (!movedKing) {
    return { ok: false, reason: 'INTERNAL_MOVE_ERROR' };
  }

  return {
    ok: true,
    board: castled.board,
    movedPiece: movedKing,
    touchedPieceIds: [king.id, castled.rookId]
  };
}

export function isKingInCheck(board: BoardState, side: Side): boolean {
  const king = board.pieces.find((piece) => piece.side === side && piece.type === 'king');
  if (!king) {
    return false;
  }

  const opponent: Side = side === 'white' ? 'black' : 'white';
  return isSquareUnderAttack(board, king.square, opponent);
}

export function validateAndApplyMove(args: {
  board: BoardState;
  side: Side;
  pieceId: string;
  to: string;
  pieceHasMoved?: Record<string, boolean>;
}): MoveValidationResult {
  const { board, side, pieceId, to, pieceHasMoved = {} } = args;

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

  const from = squareToCoord(piece.square);
  const target = squareToCoord(targetSquare);
  const isCastlingAttempt = piece.type === 'king' && Math.abs(target.file - from.file) === 2 && target.rank === from.rank;

  if (isCastlingAttempt) {
    const castlingResult = validateCastling({
      board,
      side,
      king: piece,
      to: targetSquare,
      pieceHasMoved
    });

    if (!castlingResult.ok) {
      return castlingResult;
    }

    if (isKingInCheck(castlingResult.board, side)) {
      return { ok: false, reason: 'SELF_CHECK' };
    }

    return castlingResult;
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
    movedPiece,
    touchedPieceIds: [piece.id]
  };
}

export function hasAnyLegalMove(
  board: BoardState,
  side: Side,
  pieceHasMoved: Record<string, boolean> = {}
): boolean {
  const ownPieces = board.pieces.filter((piece) => piece.side === side);

  for (const piece of ownPieces) {
    for (let file = 0; file < 8; file += 1) {
      for (let rank = 0; rank < 8; rank += 1) {
        if (!isOnBoard(file, rank)) {
          continue;
        }
        const target = coordToSquare(file, rank);
        const result = validateAndApplyMove({
          board,
          side,
          pieceId: piece.id,
          to: target,
          pieceHasMoved
        });
        if (result.ok) {
          return true;
        }
      }
    }
  }

  return false;
}
