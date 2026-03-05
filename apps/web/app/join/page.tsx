'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { JoinGameRequest, JoinGameResponse } from '@realtimechess/shared-types';

type LocalSession = {
  playerToken: string;
  side: 'white' | 'black';
};

function setSession(gameId: string, playerToken: string, side: 'white' | 'black'): void {
  localStorage.setItem(`rtc:session:${gameId}`, JSON.stringify({ playerToken, side }));
}

function getSession(gameId: string): LocalSession | null {
  const raw = localStorage.getItem(`rtc:session:${gameId}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LocalSession;
  } catch {
    return null;
  }
}

function JoinPageContent() {
  const searchParams = useSearchParams();
  const [gameId, setGameId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [autoJoining, setAutoJoining] = useState(false);
  const autoJoinAttemptedRef = useRef(false);

  const handleJoin = useCallback(
    async (
      prefill?: { gameId?: string; joinCode?: string },
      options?: { auto?: boolean }
    ) => {
      const isAuto = Boolean(options?.auto);
      if (isAuto) {
        setAutoJoining(true);
      }

      setError('');

      const normalizedGameId = (prefill?.gameId ?? gameId).trim();
      const normalizedJoinCode = (prefill?.joinCode ?? joinCode).trim();
      const existingSession = normalizedGameId ? getSession(normalizedGameId) : null;
      if (existingSession) {
        window.location.assign(`/game/${normalizedGameId}`);
        return;
      }

      try {
        const payload: JoinGameRequest = {
          gameId: normalizedGameId,
          joinCode: normalizedJoinCode
        };

        const res = await fetch('/api/games/join', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const json = (await res.json()) as JoinGameResponse | { error?: string };
        if (!res.ok) {
          setError((json as { error?: string }).error ?? 'Join failed');
          if (isAuto) {
            setAutoJoining(false);
          }
          return;
        }

        const joined = json as JoinGameResponse;
        setSession(joined.gameId, joined.playerToken, joined.side);
        const path = `/game/${joined.gameId}`;
        window.location.assign(path);
      } catch {
        setError('Join failed');
        if (isAuto) {
          setAutoJoining(false);
        }
      }
    },
    [gameId, joinCode]
  );

  useEffect(() => {
    const gameIdParam = searchParams.get('gameId')?.trim() ?? '';
    const codeParam = searchParams.get('code')?.trim() ?? '';

    if (gameIdParam) {
      setGameId(gameIdParam);
    }

    if (codeParam) {
      setJoinCode(codeParam);
    }

    if (!gameIdParam || !codeParam || autoJoinAttemptedRef.current) {
      return;
    }

    autoJoinAttemptedRef.current = true;
    void handleJoin({ gameId: gameIdParam, joinCode: codeParam }, { auto: true }).catch(() => {
      setError('Join failed');
      setAutoJoining(false);
    });
  }, [handleJoin, searchParams]);

  if (autoJoining && !error) {
    return (
      <main>
        <h1>Join Game</h1>
        <div className="card">
          <p>Joining game...</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>Join Game</h1>
      <div className="card">
        <label htmlFor="gameId">Game ID</label>
        <input id="gameId" value={gameId} onChange={(event) => setGameId(event.target.value)} />

        <label htmlFor="joinCode">Join code</label>
        <input
          id="joinCode"
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value)}
        />

        <button type="button" onClick={() => void handleJoin()}>
          Join
        </button>

        {error ? <p>{error}</p> : null}
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<main><h1>Join Game</h1></main>}>
      <JoinPageContent />
    </Suspense>
  );
}
