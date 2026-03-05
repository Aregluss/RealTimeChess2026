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
  check: '/audio/move-check.mp3',
  illegal: '/audio/illegal.mp3'
} as const;
const ACTIVE_CLOCK_TICK_MS = 100;
const POLL_INTERVAL_ACTIVE_MS = 6_000;
const POLL_INTERVAL_HIDDEN_MS = 20_000;

function logClient(event: string, payload: Record<string, unknown>): void {
  console.info(`[rtc.client.${event}] ${JSON.stringify(payload)}`);
}

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

  return `${symbols[key] ?? '?'}\uFE0E`;
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

function getCheckTimerProgress(state: GameState, side: Side, nowMs: number): number {
  const checkSinceMs =
    side === 'white'
      ? state.checkTimers.whiteInCheckSinceMs
      : state.checkTimers.blackInCheckSinceMs;

  if (checkSinceMs === null) {
    return 0;
  }

  const elapsedMs = Math.max(0, nowMs - checkSinceMs);
  const timeoutMs = Math.max(1, state.rules.checkTimeoutMs);
  return Math.max(0, Math.min(1, elapsedMs / timeoutMs));
}

function extractMoveErrorCode(message: string): string {
  if (message.startsWith('COOLDOWN_ACTIVE')) {
    return 'COOLDOWN_ACTIVE';
  }
  if (message.startsWith('Version mismatch')) {
    return 'VERSION_MISMATCH';
  }
  if (message.startsWith('PIECE_POSITION_CHANGED')) {
    return 'PIECE_POSITION_CHANGED';
  }
  return message.trim();
}

function formatMoveError(message: string): string {
  const code = extractMoveErrorCode(message);

  switch (code) {
    case 'SELF_CHECK':
      return 'Illegal move: your king would be in check.';
    case 'CASTLE_THROUGH_CHECK':
      return 'Illegal castle: king cannot move through check.';
    case 'COOLDOWN_ACTIVE':
      return 'That piece is still on cooldown.';
    case 'VERSION_MISMATCH':
      return 'Board updated. Try your move again.';
    case 'PIECE_POSITION_CHANGED':
      return 'Board updated. Piece moved; select again.';
    case 'ILLEGAL_MOVE_PATTERN':
      return 'Illegal move pattern for that piece.';
    case 'NOT_YOUR_PIECE':
      return 'That is not your piece.';
    case 'NO_OP_MOVE':
      return 'Select a different destination square.';
    default:
      return message || 'Move rejected';
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
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [realtimeMode, setRealtimeMode] = useState<'sse' | 'polling'>('polling');
  const [inviteLink, setInviteLink] = useState<string>('');
  const [shareStatus, setShareStatus] = useState<string>('');
  const [pregameLabel, setPregameLabel] = useState<string>('');
  const [illegalFlashSquare, setIllegalFlashSquare] = useState<string | null>(null);
  const [illegalFlashType, setIllegalFlashType] = useState<'piece' | 'king' | null>(null);
  const previousStateRef = useRef<GameState | null>(null);
  const pendingOwnMoveVersionRef = useRef<number | null>(null);
  const gameStartSignalMsRef = useRef<number | null>(null);
  const illegalFlashTimerRef = useRef<number | null>(null);
  const illegalFlashRafRef = useRef<number | null>(null);
  const audioRef = useRef<{
    gameStart: HTMLAudioElement | null;
    moveSelf: HTMLAudioElement | null;
    moveEnemy: HTMLAudioElement | null;
    capture: HTMLAudioElement | null;
    check: HTMLAudioElement | null;
    illegal: HTMLAudioElement | null;
  }>({
    gameStart: null,
    moveSelf: null,
    moveEnemy: null,
    capture: null,
    check: null,
    illegal: null
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

    const tickHandle = window.setInterval(() => {
      setNowMs(Date.now());
    }, ACTIVE_CLOCK_TICK_MS);

    return () => window.clearInterval(tickHandle);
  }, [state?.status]);

  useEffect(() => {
    audioRef.current.gameStart = new Audio(SOUND_FILES.gameStart);
    audioRef.current.moveSelf = new Audio(SOUND_FILES.moveSelf);
    audioRef.current.moveEnemy = new Audio(SOUND_FILES.moveEnemy);
    audioRef.current.capture = new Audio(SOUND_FILES.capture);
    audioRef.current.check = new Audio(SOUND_FILES.check);
    audioRef.current.illegal = new Audio(SOUND_FILES.illegal);

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
      audioRef.current.illegal = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (illegalFlashTimerRef.current !== null) {
        window.clearTimeout(illegalFlashTimerRef.current);
      }
      if (illegalFlashRafRef.current !== null) {
        window.cancelAnimationFrame(illegalFlashRafRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!gameId) {
      return;
    }

    let active = true;
    let eventSource: EventSource | null = null;
    let pollHandle: number | null = null;
    let sseConnected = false;

    const clearPolling = () => {
      if (pollHandle !== null) {
        window.clearInterval(pollHandle);
        pollHandle = null;
      }
    };

    const loadState = async (
      source: 'initial' | 'poll' | 'visibility' | 'sse-error'
    ): Promise<void> => {
      try {
        const res = await fetch(`/api/games/${gameId}/state`);
        const json = (await res.json()) as GameState | { error?: string };

        if (!active) {
          return;
        }

        if (!res.ok) {
          setError((json as { error?: string }).error ?? 'Failed to load state');
          return;
        }

        setState(json as GameState);
        setError('');
        if (source !== 'poll') {
          logClient('state_loaded', { gameId, source });
        }
      } catch {
        if (!active) {
          return;
        }
        setError('Failed to load state');
      }
    };

    const schedulePolling = () => {
      clearPolling();
      const intervalMs = document.hidden ? POLL_INTERVAL_HIDDEN_MS : POLL_INTERVAL_ACTIVE_MS;
      pollHandle = window.setInterval(() => {
        if (!sseConnected) {
          void loadState('poll');
        }
      }, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (sseConnected) {
        return;
      }

      schedulePolling();
      if (!document.hidden) {
        void loadState('visibility');
      }
    };

    void loadState('initial');

    if (typeof window !== 'undefined' && 'EventSource' in window) {
      eventSource = new EventSource(`/api/games/${gameId}/events`);
      eventSource.addEventListener('open', () => {
        if (!active) {
          return;
        }
        sseConnected = true;
        setRealtimeMode('sse');
        clearPolling();
        logClient('sse_open', { gameId });
      });
      eventSource.addEventListener('state', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as GameState;
          setState(payload);
          setError('');
          setRealtimeMode('sse');
        } catch {
          // ignore malformed events
        }
      });
      eventSource.addEventListener('error', () => {
        if (!active) {
          return;
        }
        sseConnected = false;
        setRealtimeMode('polling');
        schedulePolling();
        void loadState('sse-error');
        logClient('sse_error', { gameId });
      });
      schedulePolling();
    } else {
      setRealtimeMode('polling');
      schedulePolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      clearPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
    const isOwnMove =
      pendingOwnMoveVersion !== null && state.version >= pendingOwnMoveVersion;
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
      gameStartSignalMsRef.current = null;
      setPregameLabel('');
      return;
    }

    const shouldRunPregame =
      state.status === 'ACTIVE' && Boolean(state.players.black) && state.version === 2;
    if (!shouldRunPregame) {
      gameStartSignalMsRef.current = null;
      setPregameLabel('');
      return;
    }

    if (gameStartSignalMsRef.current === null) {
      gameStartSignalMsRef.current = Date.now();
      playSound('gameStart');
    }
    const startMs = gameStartSignalMsRef.current;

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
  }, [playSound, session, state?.players.black, state?.status, state?.version]);

  const triggerIllegalFeedback = useCallback(
    (square: string | null, type: 'piece' | 'king') => {
      playSound('illegal');

      if (!square) {
        return;
      }

      if (illegalFlashTimerRef.current !== null) {
        window.clearTimeout(illegalFlashTimerRef.current);
      }
      if (illegalFlashRafRef.current !== null) {
        window.cancelAnimationFrame(illegalFlashRafRef.current);
      }

      setIllegalFlashSquare(null);
      setIllegalFlashType(null);
      illegalFlashRafRef.current = window.requestAnimationFrame(() => {
        setIllegalFlashSquare(square);
        setIllegalFlashType(type);
        illegalFlashTimerRef.current = window.setTimeout(() => {
          setIllegalFlashSquare(null);
          setIllegalFlashType(null);
        }, 520);
      });
    },
    [playSound]
  );

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
    if (!state || !session || !selectedPieceId || !selectedSquare) {
      return;
    }

    setBusy(true);
    try {
      const sentAtMs = Date.now();
      pendingOwnMoveVersionRef.current = state.version + 1;
      logClient('move_submit', {
        gameId,
        pieceId: selectedPieceId,
        from: selectedSquare,
        to: toSquare,
        localVersion: state.version,
        sentAtMs
      });

      const res = await fetch(`/api/games/${gameId}/move`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.playerToken}`
        },
        body: JSON.stringify({
          pieceId: selectedPieceId,
          from: selectedSquare,
          to: toSquare,
          expectedVersion: state.version
        })
      });

      const json = await res.json();
      if (!res.ok) {
        pendingOwnMoveVersionRef.current = null;
        const serverError = (json as { error?: string }).error ?? 'Move rejected';
        const errorCode = extractMoveErrorCode(serverError);
        const ownKingSquare = session.side === 'white' ? whiteKingSquare ?? null : blackKingSquare ?? null;
        const movedPieceSquare =
          state.board.pieces.find((piece) => piece.id === selectedPieceId)?.square ?? selectedSquare;

        if (errorCode === 'SELF_CHECK' || errorCode === 'CASTLE_THROUGH_CHECK') {
          triggerIllegalFeedback(ownKingSquare ?? movedPieceSquare ?? null, 'king');
        } else {
          triggerIllegalFeedback(movedPieceSquare ?? ownKingSquare ?? null, 'piece');
        }

        logClient('move_rejected', {
          gameId,
          pieceId: selectedPieceId,
          from: selectedSquare,
          to: toSquare,
          localVersion: state.version,
          errorCode,
          serverError
        });
        setError(formatMoveError(serverError));
        return;
      }

      setState(json.state as GameState);
      logClient('move_accepted', {
        gameId,
        pieceId: selectedPieceId,
        from: selectedSquare,
        to: toSquare,
        localVersion: state.version,
        nextVersion: (json as { state?: GameState }).state?.version ?? null,
        roundTripMs: Date.now() - sentAtMs
      });
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
              Check timeout: <strong>{state.rules.checkTimeoutMs}ms</strong> | Transport:{' '}
              <strong>{realtimeMode}</strong>
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
              const checkSide: Side | null = isWhiteKingInCheck
                ? 'white'
                : isBlackKingInCheck
                  ? 'black'
                  : null;
              const checkTimerProgress =
                checkSide && state ? getCheckTimerProgress(state, checkSide, nowMs) : 0;
              const checkTimerRemaining = Math.max(0, Math.min(100, 100 - checkTimerProgress * 100));
              const showCheckTimer = Boolean(checkSide && checkTimerProgress > 0);
              const isIllegalFlashSquare = illegalFlashSquare === square;
              const illegalClass = isIllegalFlashSquare
                ? illegalFlashType === 'king'
                  ? 'illegal-king'
                  : 'illegal-piece'
                : '';

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
                  } ${isIllegalFlashSquare ? 'illegal-flash' : ''} ${illegalClass}`}
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
                  {showCheckTimer ? (
                    <svg
                      className={`check-timer-rect ${isInCheckSquare ? 'check-timer-flash' : ''}`}
                      viewBox="0 0 100 100"
                      aria-hidden="true"
                    >
                      <path
                        d="M50 5 H95 V95 H5 V5 H50"
                        fill="none"
                        stroke="rgba(231, 76, 60, 0.98)"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength="100"
                        strokeDasharray={`${checkTimerRemaining} 100`}
                      />
                    </svg>
                  ) : null}
                  <span className={`piece ${piece ? `piece-${piece.side}` : ''}`}>
                    {piece ? pieceSymbol(piece) : ''}
                  </span>
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
