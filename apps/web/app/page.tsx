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

export default function HomePage() {
  const [boardMode, setBoardMode] = useState<'classic' | 'custom'>('classic');
  const [customPiecesText, setCustomPiecesText] = useState(
    JSON.stringify(examplePieces, null, 2)
  );
  const [response, setResponse] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [gamePath, setGamePath] = useState<string>('');
  const [joinLink, setJoinLink] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<string>('');
  const [checkTimeoutMs, setCheckTimeoutMs] = useState<string>('2000');

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
    setGamePath('');
    setJoinLink('');
    setCopyStatus('');

    if (!boardSetup) {
      setError('Invalid custom board JSON.');
      return;
    }

    const payload: CreateGameRequest = {
      boardSetup,
      checkTimeoutMs: Number(checkTimeoutMs)
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
    setGamePath(`/game/${created.gameId}`);
    setJoinLink(new URL(created.joinLink, window.location.origin).toString());
    setResponse(JSON.stringify(created, null, 2));
  }

  async function handleCopyJoinLink() {
    if (!joinLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinLink);
      setCopyStatus('Join link copied.');
    } catch {
      setCopyStatus('Could not copy link. Please copy manually.');
    }
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

        <label htmlFor="checkTimeoutMs">Check timeout (milliseconds)</label>
        <input
          id="checkTimeoutMs"
          type="number"
          min={500}
          max={30000}
          step={100}
          value={checkTimeoutMs}
          onChange={(event) => setCheckTimeoutMs(event.target.value)}
        />

        <button type="button" onClick={handleCreateGame}>
          Start game
        </button>

        {gamePath ? (
          <p>
            Host session saved. Open game: <a href={gamePath}>{gamePath}</a>
          </p>
        ) : null}
        {joinLink ? (
          <>
            <p>
              Share this link with opponent: <a href={joinLink}>{joinLink}</a>
            </p>
            <button type="button" onClick={handleCopyJoinLink}>
              Copy join link
            </button>
          </>
        ) : null}
        {copyStatus ? <p>{copyStatus}</p> : null}
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
