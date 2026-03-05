'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { GameState, Piece, Side } from '@realtimechess/shared-types';

type Session = {
  playerToken: string;
  side: Side;
};

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;
const SOUND_FILES = {
  gameStart: '/audio/game_start.mp3',
  moveSelf: '/audio/move-self.mp3',
  moveEnemy: '/audio/move-opponent.mp3',
  capture: '/audio/capture.mp3',
  check: '/audio/move-check.mp3'
} as const;

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

function getFinishMessage(state: GameState, session: Session | null): string {
  if (!session || !state.winner) {
    return `Game finished (${state.finishReason ?? 'UNKNOWN'}).`;
  }

  if (state.winner === session.side) {
    return `Victory (${state.finishReason ?? 'UNKNOWN'})`;
  }

  return `Defeat (${state.finishReason ?? 'UNKNOWN'})`;
}

function getCooldownRatio(piece: Piece, state: GameState, nowMs: number): number {
  const until = state.cooldowns[piece.id] ?? 0;
  if (until <= nowMs) {
    return 0;
  }

  const total = state.rules.pieceCooldownMs[piece.type] || 1;
  return Math.max(0, Math.min(1, (until - nowMs) / total));
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
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [inviteLink, setInviteLink] = useState<string>('');
  const [shareStatus, setShareStatus] = useState<string>('');
  const [pregameLabel, setPregameLabel] = useState<string>('');
  const previousStateRef = useRef<GameState | null>(null);
  const pendingOwnMoveVersionRef = useRef<number | null>(null);
  const gameStartSignalMsRef = useRef<number | null>(null);
  const audioRef = useRef<{
    gameStart: HTMLAudioElement | null;
    moveSelf: HTMLAudioElement | null;
    moveEnemy: HTMLAudioElement | null;
    capture: HTMLAudioElement | null;
    check: HTMLAudioElement | null;
  }>({
    gameStart: null,
    moveSelf: null,
    moveEnemy: null,
    capture: null,
    check: null
  });

  const playSound = useCallback((name: keyof typeof SOUND_FILES): void => {
    const player = audioRef.current[name];
    if (!player) {
      return;
    }

    player.currentTime = 0;
    void player.play().catch(() => {
      // Ignore autoplay restrictions and missing/invalid asset errors.
    });
  }, []);

  useEffect(() => {
    if (!gameId) {
      return;
    }

    setSession(loadSession(gameId));
  }, [gameId]);

  useEffect(() => {
    if (!gameId || !session || session.side !== 'white') {
      setInviteLink('');
      setShareStatus('');
      return;
    }

    const savedInvite = localStorage.getItem(`rtc:invite:${gameId}`) ?? '';
    setInviteLink(savedInvite);
  }, [gameId, session]);

  useEffect(() => {
    if (state?.status !== 'ACTIVE') {
      setNowMs(Date.now());
      return;
    }

    let frameId = 0;
    const tick = () => {
      setNowMs(Date.now());
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [state?.status]);

  useEffect(() => {
    audioRef.current.gameStart = new Audio(SOUND_FILES.gameStart);
    audioRef.current.moveSelf = new Audio(SOUND_FILES.moveSelf);
    audioRef.current.moveEnemy = new Audio(SOUND_FILES.moveEnemy);
    audioRef.current.capture = new Audio(SOUND_FILES.capture);
    audioRef.current.check = new Audio(SOUND_FILES.check);

    for (const player of Object.values(audioRef.current)) {
      if (!player) {
        continue;
      }
      player.preload = 'auto';
      player.volume = 0.9;
    }

    return () => {
      for (const player of Object.values(audioRef.current)) {
        if (!player) {
          continue;
        }
        player.pause();
        player.src = '';
      }
      audioRef.current.gameStart = null;
      audioRef.current.moveSelf = null;
      audioRef.current.moveEnemy = null;
      audioRef.current.capture = null;
      audioRef.current.check = null;
    };
  }, []);

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

    let eventSource: EventSource | null = null;
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource(`/api/games/${gameId}/events`);
      eventSource.addEventListener('state', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as GameState;
          setState(payload);
          setError('');
        } catch {
          // ignore malformed events
        }
      });
    }

    const pollHandle = setInterval(loadState, 1500);

    return () => {
      active = false;
      clearInterval(pollHandle);
      eventSource?.close();
    };
  }, [gameId]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const previous = previousStateRef.current;
    previousStateRef.current = state;

    if (!previous || !session) {
      return;
    }

    if (state.version <= previous.version) {
      return;
    }

    const pendingOwnMoveVersion = pendingOwnMoveVersionRef.current;
    const isOwnMove = pendingOwnMoveVersion === state.version;
    if (pendingOwnMoveVersion !== null && state.version >= pendingOwnMoveVersion) {
      pendingOwnMoveVersionRef.current = null;
    }

    const isCapture = state.board.pieces.length < previous.board.pieces.length;
    if (isCapture) {
      playSound('capture');
    } else if (isOwnMove) {
      playSound('moveSelf');
    } else {
      playSound('moveEnemy');
    }

    const wasInCheck =
      session.side === 'white'
        ? previous.checkState.whiteInCheck
        : previous.checkState.blackInCheck;
    const isNowInCheck =
      session.side === 'white' ? state.checkState.whiteInCheck : state.checkState.blackInCheck;

    if (!wasInCheck && isNowInCheck) {
      playSound('check');
    }
  }, [playSound, session, state]);

  useEffect(() => {
    if (!state || !session) {
      setPregameLabel('');
      return;
    }

    const isGameStarted = state.status === 'ACTIVE' && Boolean(state.players.black);
    if (!isGameStarted) {
      gameStartSignalMsRef.current = null;
      setPregameLabel('');
      return;
    }

    const startMs = state.lastStateChangeAtServerMs;
    if (gameStartSignalMsRef.current !== startMs) {
      gameStartSignalMsRef.current = startMs;
      playSound('gameStart');
    }

    const updateCountdown = () => {
      const elapsedMs = Date.now() - startMs;
      if (elapsedMs < 1_000) {
        setPregameLabel('3');
        return;
      }
      if (elapsedMs < 2_000) {
        setPregameLabel('2');
        return;
      }
      if (elapsedMs < 3_000) {
        setPregameLabel('1');
        return;
      }
      if (elapsedMs < 4_000) {
        setPregameLabel('GO');
        return;
      }
      setPregameLabel('');
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 100);
    return () => window.clearInterval(timer);
  }, [playSound, session, state]);

  async function handleCopyInvite(): Promise<void> {
    if (!inviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      setShareStatus('Invite copied.');
    } catch {
      setShareStatus('Copy failed. Share manually.');
    }
  }

  async function handleShareInvite(): Promise<void> {
    if (!inviteLink) {
      return;
    }

    if (typeof navigator.share !== 'function') {
      await handleCopyInvite();
      return;
    }

    try {
      await navigator.share({
        title: 'Join my RealTimeChess game',
        text: 'Tap to join my game',
        url: inviteLink
      });
      setShareStatus('Invite shared.');
    } catch {
      // Ignore cancellation.
    }
  }

  const boardIndex = useMemo(() => {
    const index = new Map<string, Piece>();
    for (const piece of state?.board.pieces ?? []) {
      index.set(piece.square, piece);
    }
    return index;
  }, [state]);

  const whiteKingSquare = useMemo(
    () => state?.board.pieces.find((piece) => piece.side === 'white' && piece.type === 'king')?.square,
    [state]
  );

  const blackKingSquare = useMemo(
    () => state?.board.pieces.find((piece) => piece.side === 'black' && piece.type === 'king')?.square,
    [state]
  );

  async function submitMove(toSquare: string): Promise<void> {
    if (!state || !session || !selectedPieceId) {
      return;
    }

    setBusy(true);
    try {
      pendingOwnMoveVersionRef.current = state.version + 1;
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
        pendingOwnMoveVersionRef.current = null;
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

  const canInteract = Boolean(session && state && state.status === 'ACTIVE' && !busy && !pregameLabel);
  const orientedFiles = session?.side === 'black' ? [...files].reverse() : files;
  const orientedRanks = session?.side === 'black' ? [...ranks].reverse() : ranks;

  return (
    <main>
      <h1>Game {gameId}</h1>
      <div className="game-meta" aria-live="polite">
        <p className="game-meta-line">
          {!session ? (
            'No local session token for this game. Start/join from home first in this browser.'
          ) : (
            <>
              You are <strong>{session.side}</strong>
            </>
          )}
        </p>
        <p className="game-meta-line">
          {state ? (
            <>
              Status: <strong>{state.status}</strong> | Version: <strong>{state.version}</strong> |
              Check timeout: <strong>{state.rules.checkTimeoutMs}ms</strong>
            </>
          ) : (
            <span>&nbsp;</span>
          )}
        </p>
        <p className="game-meta-line">
          {selectedPieceId ? (
            <>
              Selected: <code>{selectedPieceId}</code> at <code>{selectedSquare}</code>
            </>
          ) : (
            'Select one of your pieces, then click destination.'
          )}
        </p>
        <p className="game-meta-line game-meta-error" role={error ? 'alert' : undefined}>
          {error || <span>&nbsp;</span>}
        </p>
        {session?.side === 'white' && inviteLink ? (
          <div className="invite-actions">
            <button type="button" onClick={handleCopyInvite}>
              Copy invite link
            </button>
            <button type="button" onClick={handleShareInvite}>
              Share invite
            </button>
          </div>
        ) : null}
        {shareStatus ? <p className="game-meta-line">{shareStatus}</p> : null}
      </div>

      <div className="board-wrap">
        <div className="board" aria-label="chess-board">
          {orientedRanks.map((rank, rankIndex) =>
            orientedFiles.map((file, fileIndex) => {
              const square = `${file}${rank}`;
              const piece = boardIndex.get(square);
              const isLight = (rankIndex + fileIndex) % 2 === 0;
              const isSelected = selectedSquare === square;
              const isWhiteKingInCheck =
                Boolean(state?.checkState.whiteInCheck) && whiteKingSquare === square;
              const isBlackKingInCheck =
                Boolean(state?.checkState.blackInCheck) && blackKingSquare === square;
              const isInCheckSquare = isWhiteKingInCheck || isBlackKingInCheck;

              const showCooldown = Boolean(
                piece && state && session && piece.side === session.side
              );
              const cooldownRatio =
                piece && state && showCooldown ? getCooldownRatio(piece, state, nowMs) : 0;
              const cooldownProgress = Math.max(0, Math.min(100, cooldownRatio * 100));

              return (
                <button
                  type="button"
                  key={square}
                  onClick={() => onSquareClick(square)}
                  className={`square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''} ${
                    isInCheckSquare ? 'in-check' : ''
                  }`}
                  disabled={!canInteract}
                  title={square}
                >
                  {cooldownRatio > 0 ? (
                    <svg className="cooldown-rect" viewBox="0 0 100 100" aria-hidden="true">
                      <path
                        d="M50 5 H95 V95 H5 V5 H50"
                        fill="none"
                        stroke="rgba(74, 158, 255, 0.95)"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength="100"
                        strokeDasharray={`${cooldownProgress} 100`}
                      />
                    </svg>
                  ) : null}
                  <span className="piece">{piece ? pieceSymbol(piece) : ''}</span>
                  <span className="coord">{square}</span>
                </button>
              );
            })
          )}
        </div>

        {state?.status === 'FINISHED' ? (
          <div className="finish-overlay" role="status" aria-live="polite">
            <h2>{getFinishMessage(state, session)}</h2>
            <p>
              Winner: <strong>{state.winner ?? 'none'}</strong>
            </p>
            <p>
              Reason: <strong>{state.finishReason ?? 'UNKNOWN'}</strong>
            </p>
            <p>
              <a href="/">Start new game</a>
            </p>
          </div>
        ) : null}
        {pregameLabel ? (
          <div className="countdown-overlay" role="status" aria-live="assertive">
            <h2>{pregameLabel}</h2>
          </div>
        ) : null}
      </div>
    </main>
  );
}
