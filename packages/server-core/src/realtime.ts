import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import type { GameEventPayload } from '@realtimechess/shared-types';

type Handler = (event: GameEventPayload) => void;

type RealtimeGlobals = typeof globalThis & {
  __rtcEmitter?: EventEmitter;
  __rtcRealtimePub?: Redis;
  __rtcRealtimeSub?: Redis;
  __rtcRealtimeSubStarted?: boolean;
  __rtcRealtimeHandlers?: Map<string, Set<Handler>>;
};

function channelForGame(gameId: string): string {
  return `rtc:events:${gameId}`;
}

function getGlobals(): RealtimeGlobals {
  return globalThis as RealtimeGlobals;
}

function getEmitter(): EventEmitter {
  const globals = getGlobals();
  if (!globals.__rtcEmitter) {
    globals.__rtcEmitter = new EventEmitter();
  }
  return globals.__rtcEmitter;
}

function hasRedisRealtime(): boolean {
  return Boolean(process.env.REDIS_URL);
}

function getRedisPublisher(): Redis {
  const globals = getGlobals();
  if (!globals.__rtcRealtimePub) {
    globals.__rtcRealtimePub = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true
    });
  }
  return globals.__rtcRealtimePub;
}

function getRedisSubscriber(): Redis {
  const globals = getGlobals();
  if (!globals.__rtcRealtimeSub) {
    globals.__rtcRealtimeSub = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true
    });
  }
  return globals.__rtcRealtimeSub;
}

async function ensureRedisSubscriberStarted(): Promise<void> {
  const globals = getGlobals();
  if (globals.__rtcRealtimeSubStarted) {
    return;
  }

  const sub = getRedisSubscriber();
  const handlers = globals.__rtcRealtimeHandlers ?? new Map<string, Set<Handler>>();
  globals.__rtcRealtimeHandlers = handlers;

  sub.on('message', (channel, rawPayload) => {
    const gameId = channel.replace('rtc:events:', '');
    const gameHandlers = handlers.get(gameId);
    if (!gameHandlers || gameHandlers.size === 0) {
      return;
    }

    try {
      const parsed = JSON.parse(rawPayload) as GameEventPayload;
      for (const handler of gameHandlers) {
        handler(parsed);
      }
    } catch {
      // Ignore malformed payloads.
    }
  });

  globals.__rtcRealtimeSubStarted = true;
}

export async function publishGameEvent(event: GameEventPayload): Promise<void> {
  if (hasRedisRealtime()) {
    const publisher = getRedisPublisher();
    await publisher.publish(channelForGame(event.gameId), JSON.stringify(event));
    return;
  }

  const emitter = getEmitter();
  emitter.emit(channelForGame(event.gameId), event);
}

export async function subscribeToGameEvents(
  gameId: string,
  handler: Handler
): Promise<() => Promise<void>> {
  const channel = channelForGame(gameId);

  if (hasRedisRealtime()) {
    const globals = getGlobals();
    const handlers = globals.__rtcRealtimeHandlers ?? new Map<string, Set<Handler>>();
    globals.__rtcRealtimeHandlers = handlers;

    let gameHandlers = handlers.get(gameId);
    if (!gameHandlers) {
      gameHandlers = new Set<Handler>();
      handlers.set(gameId, gameHandlers);
    }

    gameHandlers.add(handler);

    await ensureRedisSubscriberStarted();

    const subscriber = getRedisSubscriber();
    await subscriber.subscribe(channel);

    return async () => {
      const currentHandlers = handlers.get(gameId);
      if (!currentHandlers) {
        return;
      }

      currentHandlers.delete(handler);
      if (currentHandlers.size === 0) {
        handlers.delete(gameId);
        await subscriber.unsubscribe(channel);
      }
    };
  }

  const emitter = getEmitter();
  emitter.on(channel, handler);

  return async () => {
    emitter.off(channel, handler);
  };
}
