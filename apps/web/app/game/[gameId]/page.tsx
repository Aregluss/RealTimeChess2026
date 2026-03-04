'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { GameState, Piece, Side } from '@realtimechess/shared-types';

type Session = {
  playerToken: string;
  side: Side;
};

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

function pieceSymbol(piece: Piece): string {
  const key = `${piece.side}:${piece.type}`;
  const symbols: Record<string, string> = {
    'white:king': '♔',
    'white:queen': '♕',
    'white:rook': '♖',
    'white:bishop': '♗',
    'white:knight': '♘',
    'white:pawn': '♙',
    'black:king': '♚',
    'black:queen': '♛',
    'black:rook': '♜',
    'black:bishop': '♝',
    'black:knight': '♞',
    'black:pawn': '♟'
  };

  return symbols[key] ?? '?';
}

function loadSession(gameId: string): Session | null {
  const raw = localStorage.getItem(`rtc:session:${gameId}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;

  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string>('');
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    if (!gameId) {
      return;
    }

    const sess = loadSession(gameId);
    setSession(sess);
  }, [gameId]);

  useEffect(() => {
    if (!gameId) {
      return;
    }

    let active = true;

    async function loadState() {
      const res = await fetch(`/api/games/${gameId}/state`);
      const json = await res.json();

      if (!active) {
        return;
      }

      if (!res.ok) {
        setError(json.error ?? 'Failed to load state');
        return;
      }

      setState(json as GameState);
      setError('');
    }

    loadState();
    const handle = setInterval(loadState, 500);

    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [gameId]);

  const boardIndex = useMemo(() => {
    const index = new Map<string, Piece>();
    for (const piece of state?.board.pieces ?? []) {
      index.set(piece.square, piece);
    }
    return index;
  }, [state]);

  async function submitMove(toSquare: string): Promise<void> {
    if (!state || !session || !selectedPieceId) {
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/games/${gameId}/move`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.playerToken}`
        },
        body: JSON.stringify({
          pieceId: selectedPieceId,
          to: toSquare,
          expectedVersion: state.version
        })
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Move rejected');
        return;
      }

      setState(json.state as GameState);
      setError('');
      setSelectedPieceId(null);
      setSelectedSquare(null);
    } finally {
      setBusy(false);
    }
  }

  function onSquareClick(square: string): void {
    if (!state || !session || busy) {
      return;
    }

    const piece = boardIndex.get(square);

    if (!selectedPieceId) {
      if (piece && piece.side === session.side) {
        setSelectedPieceId(piece.id);
        setSelectedSquare(square);
      }
      return;
    }

    if (piece && piece.side === session.side) {
      setSelectedPieceId(piece.id);
      setSelectedSquare(square);
      return;
    }

    void submitMove(square);
  }

  return (
    <main>
      <h1>Game {gameId}</h1>
      {!session ? (
        <p>
          No local session token for this game. Start/join from home first in this browser.
        </p>
      ) : (
        <p>
          You are <strong>{session.side}</strong>
        </p>
      )}
      {state ? (
        <p>
          Status: <strong>{state.status}</strong> | Version: <strong>{state.version}</strong>
        </p>
      ) : null}
      {selectedPieceId ? (
        <p>
          Selected: <code>{selectedPieceId}</code> at <code>{selectedSquare}</code>
        </p>
      ) : (
        <p>Select one of your pieces, then click destination.</p>
      )}
      {error ? <p>{error}</p> : null}

      <div className="board" aria-label="chess-board">
        {ranks.map((rank, rankIndex) =>
          files.map((file, fileIndex) => {
            const square = `${file}${rank}`;
            const piece = boardIndex.get(square);
            const isLight = (rankIndex + fileIndex) % 2 === 0;
            const isSelected = selectedSquare === square;

            return (
              <button
                type="button"
                key={square}
                onClick={() => onSquareClick(square)}
                className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''}`}
                disabled={!session || busy || !state || state.status !== 'ACTIVE'}
                title={square}
              >
                <span className="piece">{piece ? pieceSymbol(piece) : ''}</span>
                <span className="coord">{square}</span>
              </button>
            );
          })
        )}
      </div>
    </main>
  );
}
