'use client';

import { useMemo, useState } from 'react';
import type {
  CreateGameRequest,
  CreateGameResponse,
  PiecePlacement,
  BoardSetupRequest
} from '@realtimechess/shared-types';

const examplePieces: PiecePlacement[] = [
  { side: 'white', type: 'king', square: 'e1' },
  { side: 'black', type: 'king', square: 'e8' },
  { side: 'white', type: 'rook', square: 'a1' },
  { side: 'black', type: 'rook', square: 'h8' }
];

function setSession(gameId: string, playerToken: string, side: 'white' | 'black'): void {
  localStorage.setItem(`rtc:session:${gameId}`, JSON.stringify({ playerToken, side }));
}

function setInviteLink(gameId: string, inviteLink: string): void {
  localStorage.setItem(`rtc:invite:${gameId}`, inviteLink);
}

export default function HomePage() {
  const [boardMode, setBoardMode] = useState<'classic' | 'custom'>('classic');
  const [customPiecesText, setCustomPiecesText] = useState(
    JSON.stringify(examplePieces, null, 2)
  );
  const [response, setResponse] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [checkTimeoutSeconds, setCheckTimeoutSeconds] = useState<string>('5');

  const boardSetup: BoardSetupRequest | undefined = useMemo(() => {
    if (boardMode === 'classic') {
      return { kind: 'classic' };
    }

    try {
      const pieces = JSON.parse(customPiecesText) as PiecePlacement[];
      return { kind: 'custom', pieces };
    } catch {
      return undefined;
    }
  }, [boardMode, customPiecesText]);

  async function handleCreateGame() {
    setError('');
    setResponse('');

    if (!boardSetup) {
      setError('Invalid custom board JSON.');
      return;
    }

    const payload: CreateGameRequest = {
      boardSetup,
      checkTimeoutMs: Number(checkTimeoutSeconds) * 1000
    };

    const res = await fetch('/api/games/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = (await res.json()) as CreateGameResponse | { error?: string };
    if (!res.ok) {
      setError((json as { error?: string }).error ?? 'Failed to create game');
      return;
    }

    const created = json as CreateGameResponse;
    setSession(created.gameId, created.playerToken, created.side);
    const inviteLink = new URL(created.joinLink, window.location.origin).toString();
    setInviteLink(created.gameId, inviteLink);
    setResponse(JSON.stringify(created, null, 2));
    window.location.assign(`/game/${created.gameId}`);
  }

  return (
    <main>
      <h1>RealTimeChess</h1>
      <p>
        Iteration 2: server-authoritative move endpoint + clickable local board for two-browser
        testing.
      </p>

      <div className="card">
        <h2>Create game</h2>
        <label htmlFor="boardMode">Board mode</label>
        <select
          id="boardMode"
          value={boardMode}
          onChange={(event) => setBoardMode(event.target.value as 'classic' | 'custom')}
        >
          <option value="classic">Classic</option>
          <option value="custom">Custom (testing)</option>
        </select>

        {boardMode === 'custom' ? (
          <>
            <label htmlFor="customBoard">Custom pieces JSON</label>
            <textarea
              id="customBoard"
              rows={12}
              value={customPiecesText}
              onChange={(event) => setCustomPiecesText(event.target.value)}
            />
          </>
        ) : null}

        <label htmlFor="checkTimeoutSeconds">Check timeout</label>
        <select
          id="checkTimeoutSeconds"
          value={checkTimeoutSeconds}
          onChange={(event) => setCheckTimeoutSeconds(event.target.value)}
        >
          <option value="2">2 seconds</option>
          <option value="3">3 seconds</option>
          <option value="4">4 seconds</option>
          <option value="5">5 seconds</option>
          <option value="6">6 seconds</option>
          <option value="7">7 seconds</option>
          <option value="8">8 seconds</option>
          <option value="9">9 seconds</option>
          <option value="10">10 seconds</option>
        </select>

        <button type="button" onClick={handleCreateGame}>
          Start game
        </button>

        {error ? <p>{error}</p> : null}
        {response ? <pre>{response}</pre> : null}
      </div>

      <div className="card">
        <h2>Join existing game</h2>
        <p>
          Use the join page: <a href="/join">/join</a>
        </p>
      </div>
    </main>
  );
}
