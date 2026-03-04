export type Side = 'white' | 'black';

export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export type FileChar = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type RankChar = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';

export type Square = `${FileChar}${RankChar}`;

export interface Piece {
  id: string;
  side: Side;
  type: PieceType;
  square: Square;
}

export interface PiecePlacement {
  id?: string;
  side: Side;
  type: PieceType;
  square: Square;
}

export interface BoardState {
  pieces: Piece[];
}

export type BoardSetupRequest =
  | {
      kind: 'classic';
    }
  | {
      kind: 'custom';
      pieces: PiecePlacement[];
    };

export type GameStatus =
  | 'LOBBY_WAITING'
  | 'ACTIVE'
  | 'RECONNECT_GRACE'
  | 'FINISHED'
  | 'DISCARDED';

export interface PlayerState {
  tokenHash: string;
  connected: boolean;
  disconnectedSinceMs: number | null;
}

export interface GameState {
  gameId: string;
  status: GameStatus;
  version: number;
  createdAtServerMs: number;
  lastStateChangeAtServerMs: number;
  lastMoveAtServerMs: number | null;
  finishedAtServerMs: number | null;
  winner: Side | null;
  finishReason: string | null;
  board: BoardState;
  cooldowns: Record<string, number>;
  checkTimers: {
    whiteInCheckSinceMs: number | null;
    blackInCheckSinceMs: number | null;
  };
  checkState: {
    whiteInCheck: boolean;
    blackInCheck: boolean;
  };
  pieceHasMoved: Record<string, boolean>;
  rules: {
    checkTimeoutMs: number;
  };
  players: {
    white: PlayerState;
    black: PlayerState | null;
  };
}
