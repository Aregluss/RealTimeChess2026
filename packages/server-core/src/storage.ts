import Redis from 'ioredis';
import type { GameState } from '@realtimechess/shared-types';

export type GameRecord = {
  gameId: string;
  joinCode: string;
  joinExpiresAtMs: number;
  whiteToken: string;
  blackToken: string | null;
  state: GameState;
};

type JoinCodeRecord = {
  gameId: string;
};

interface StorageAdapter {
  getGameRecord(gameId: string): Promise<GameRecord | null>;
  setGameRecord(record: GameRecord, ttlMs: number): Promise<void>;
  compareAndSwapGameRecord(
    gameId: string,
    expectedVersion: number,
    nextRecord: GameRecord,
    ttlMs: number
  ): Promise<boolean>;
  deleteGameRecord(gameId: string): Promise<void>;
  setJoinCode(joinCode: string, value: JoinCodeRecord, ttlMs: number): Promise<void>;
  getJoinCode(joinCode: string): Promise<JoinCodeRecord | null>;
  deleteJoinCode(joinCode: string): Promise<void>;
}

const REDIS_CAS_GAME_RECORD_LUA = `
local key = KEYS[1]
local expectedVersion = tonumber(ARGV[1])
local nextPayload = ARGV[2]
local ttlMs = tonumber(ARGV[3])

local currentRaw = redis.call('GET', key)
if not currentRaw then
  return 0
end

local ok, decoded = pcall(cjson.decode, currentRaw)
if not ok or type(decoded) ~= 'table' then
  return -1
end

local state = decoded['state']
if type(state) ~= 'table' then
  return -1
end

local currentVersion = tonumber(state['version'])
if currentVersion ~= expectedVersion then
  return 0
end

redis.call('SET', key, nextPayload, 'PX', ttlMs)
return 1
`;

function maxTtl(ttlMs: number): number {
  return Math.max(1_000, Math.floor(ttlMs));
}

class MemoryStorage implements StorageAdapter {
  private games = new Map<string, { record: GameRecord; expiresAtMs: number }>();

  private joinCodes = new Map<string, { value: JoinCodeRecord; expiresAtMs: number }>();

  private prune(nowMs: number): void {
    for (const [gameId, entry] of this.games.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.games.delete(gameId);
      }
    }

    for (const [joinCode, entry] of this.joinCodes.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.joinCodes.delete(joinCode);
      }
    }
  }

  async getGameRecord(gameId: string): Promise<GameRecord | null> {
    const nowMs = Date.now();
    this.prune(nowMs);

    return this.games.get(gameId)?.record ?? null;
  }

  async setGameRecord(record: GameRecord, ttlMs: number): Promise<void> {
    const nowMs = Date.now();
    this.prune(nowMs);

    this.games.set(record.gameId, {
      record,
      expiresAtMs: nowMs + maxTtl(ttlMs)
    });
  }

  async compareAndSwapGameRecord(
    gameId: string,
    expectedVersion: number,
    nextRecord: GameRecord,
    ttlMs: number
  ): Promise<boolean> {
    const nowMs = Date.now();
    this.prune(nowMs);

    const current = this.games.get(gameId);
    if (!current) {
      return false;
    }

    if (current.record.state.version !== expectedVersion) {
      return false;
    }

    this.games.set(gameId, {
      record: nextRecord,
      expiresAtMs: nowMs + maxTtl(ttlMs)
    });

    return true;
  }

  async deleteGameRecord(gameId: string): Promise<void> {
    this.games.delete(gameId);
  }

  async setJoinCode(joinCode: string, value: JoinCodeRecord, ttlMs: number): Promise<void> {
    const nowMs = Date.now();
    this.prune(nowMs);

    this.joinCodes.set(joinCode, {
      value,
      expiresAtMs: nowMs + maxTtl(ttlMs)
    });
  }

  async getJoinCode(joinCode: string): Promise<JoinCodeRecord | null> {
    const nowMs = Date.now();
    this.prune(nowMs);

    return this.joinCodes.get(joinCode)?.value ?? null;
  }

  async deleteJoinCode(joinCode: string): Promise<void> {
    this.joinCodes.delete(joinCode);
  }
}

class RedisStorage implements StorageAdapter {
  constructor(private redis: Redis) {}

  private gameKey(gameId: string): string {
    return `rtc:game:${gameId}`;
  }

  private joinCodeKey(joinCode: string): string {
    return `rtc:join:${joinCode}`;
  }

  async getGameRecord(gameId: string): Promise<GameRecord | null> {
    const raw = await this.redis.get(this.gameKey(gameId));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as GameRecord;
  }

  async setGameRecord(record: GameRecord, ttlMs: number): Promise<void> {
    await this.redis.set(
      this.gameKey(record.gameId),
      JSON.stringify(record),
      'PX',
      maxTtl(ttlMs)
    );
  }

  async compareAndSwapGameRecord(
    gameId: string,
    expectedVersion: number,
    nextRecord: GameRecord,
    ttlMs: number
  ): Promise<boolean> {
    const key = this.gameKey(gameId);
    const nextPayload = JSON.stringify(nextRecord);
    const boundedTtl = maxTtl(ttlMs);
    const evalResult = await this.redis.eval(
      REDIS_CAS_GAME_RECORD_LUA,
      1,
      key,
      expectedVersion,
      nextPayload,
      boundedTtl
    );

    return Number(evalResult) === 1;
  }

  async deleteGameRecord(gameId: string): Promise<void> {
    await this.redis.del(this.gameKey(gameId));
  }

  async setJoinCode(joinCode: string, value: JoinCodeRecord, ttlMs: number): Promise<void> {
    await this.redis.set(this.joinCodeKey(joinCode), JSON.stringify(value), 'PX', maxTtl(ttlMs));
  }

  async getJoinCode(joinCode: string): Promise<JoinCodeRecord | null> {
    const raw = await this.redis.get(this.joinCodeKey(joinCode));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as JoinCodeRecord;
  }

  async deleteJoinCode(joinCode: string): Promise<void> {
    await this.redis.del(this.joinCodeKey(joinCode));
  }
}

type ServerCoreGlobals = typeof globalThis & {
  __rtcStorage?: StorageAdapter;
  __rtcRedisClient?: Redis;
};

function resolveStorage(): StorageAdapter {
  const globals = globalThis as ServerCoreGlobals;
  if (globals.__rtcStorage) {
    return globals.__rtcStorage;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    const memory = new MemoryStorage();
    globals.__rtcStorage = memory;
    return memory;
  }

  const redis =
    globals.__rtcRedisClient ??
    new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true
    });

  globals.__rtcRedisClient = redis;

  const redisStorage = new RedisStorage(redis);
  globals.__rtcStorage = redisStorage;
  return redisStorage;
}

export const storage: StorageAdapter = resolveStorage();
