'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import type { JoinGameRequest, JoinGameResponse } from '@realtimechess/shared-types';

function setSession(gameId: string, playerToken: string, side: 'white' | 'black'): void {
  localStorage.setItem(`rtc:session:${gameId}`, JSON.stringify({ playerToken, side }));
}

export default function JoinPage() {
  const searchParams = useSearchParams();
  const [gameId, setGameId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [gamePath, setGamePath] = useState('');

  useEffect(() => {
    const gameIdParam = searchParams.get('gameId');
    const codeParam = searchParams.get('code');

    if (gameIdParam) {
      setGameId(gameIdParam);
    }

    if (codeParam) {
      setJoinCode(codeParam);
    }
  }, [searchParams]);

  async function handleJoin() {
    setError('');
    setResponse('');
    setGamePath('');

    const payload: JoinGameRequest = {
      gameId: gameId.trim(),
      joinCode: joinCode.trim()
    };

    const res = await fetch('/api/games/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = (await res.json()) as JoinGameResponse | { error?: string };
    if (!res.ok) {
      setError((json as { error?: string }).error ?? 'Join failed');
      return;
    }

    const joined = json as JoinGameResponse;
    setSession(joined.gameId, joined.playerToken, joined.side);
    const path = `/game/${joined.gameId}`;
    setGamePath(path);
    setResponse(JSON.stringify(joined, null, 2));
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

        <button type="button" onClick={handleJoin}>
          Join
        </button>

        {gamePath ? (
          <p>
            Session saved. Open game: <a href={gamePath}>{gamePath}</a>
          </p>
        ) : null}
        {error ? <p>{error}</p> : null}
        {response ? <pre>{response}</pre> : null}
      </div>
    </main>
  );
}
