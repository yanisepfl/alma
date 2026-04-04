/**
 * Persistent storage via Upstash Redis.
 *
 * Key schema (all prefixed with `alma:` to avoid collisions):
 *
 *   alma:activity:{address}   — sorted set of activity entries (score = timestamp)
 *   alma:rebalances:{address} — sorted set of rebalance records (score = timestamp)
 *   alma:users                — set of registered user addresses
 *   alma:stats:{address}      — hash with per-user aggregate stats
 */

import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// Client — falls back to in-memory when Redis isn't configured
// ---------------------------------------------------------------------------

const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = hasRedis
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

if (!hasRedis) {
  console.warn('[store] No Redis configured — using in-memory fallback');
}

// In-memory fallback
const mem = {
  users: new Set<string>(),
  activities: [] as Activity[],
  rebalances: [] as RebalanceRecord[],
  stats: new Map<string, UserStats>(),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Activity {
  id: string;
  type: 'monitor' | 'rebalance' | 'delegation' | 'registration';
  status: 'completed' | 'failed' | 'in_progress' | 'evaluating';
  summary: string;
  timestamp: number;
  tokenId?: string;
  owner?: string;
  txHashes?: string[];
}

export interface RebalanceRecord {
  id: string;
  tokenId: string;
  owner: string;
  timestamp: number;
  success: boolean;
  txHash?: string;
  blockNumber?: string;
  newRange?: { tickLower: number; tickUpper: number };
  error?: string;
  details?: Record<string, any>;
}

export interface UserStats {
  address: string;
  positionCount: number;
  totalRebalances: number;
  successfulRebalances: number;
  failedRebalances: number;
  lastScanAt: number;
  registeredAt: number;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const K = {
  activity: (addr: string) => `alma:activity:${addr.toLowerCase()}`,
  rebalances: (addr: string) => `alma:rebalances:${addr.toLowerCase()}`,
  users: 'alma:users',
  stats: (addr: string) => `alma:stats:${addr.toLowerCase()}`,
  allActivity: 'alma:activity:all',
  allRebalances: 'alma:rebalances:all',
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function registerUser(address: string): Promise<void> {
  const addr = address.toLowerCase();
  if (!redis) {
    mem.users.add(addr);
    if (!mem.stats.has(addr)) {
      mem.stats.set(addr, { address: addr, positionCount: 0, totalRebalances: 0, successfulRebalances: 0, failedRebalances: 0, lastScanAt: 0, registeredAt: Date.now() });
    }
    return;
  }
  await redis.sadd(K.users, addr);
  const exists = await redis.exists(K.stats(addr));
  if (!exists) {
    await redis.hset(K.stats(addr), { address: addr, positionCount: 0, totalRebalances: 0, successfulRebalances: 0, failedRebalances: 0, lastScanAt: 0, registeredAt: Date.now() });
  }
}

export async function getRegisteredUsers(): Promise<string[]> {
  if (!redis) return [...mem.users];
  return (await redis.smembers(K.users)) as string[];
}

export async function getUserStats(address: string): Promise<UserStats | null> {
  if (!redis) return mem.stats.get(address.toLowerCase()) ?? null;
  const data = await redis.hgetall(K.stats(address.toLowerCase()));
  if (!data || Object.keys(data).length === 0) return null;
  return data as unknown as UserStats;
}

export async function updateUserStats(address: string, updates: Partial<UserStats>): Promise<void> {
  if (!redis) {
    const existing = mem.stats.get(address.toLowerCase());
    if (existing) mem.stats.set(address.toLowerCase(), { ...existing, ...updates });
    return;
  }
  await redis.hset(K.stats(address.toLowerCase()), updates as Record<string, any>);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

let activityCounter = 0;

export async function logActivity(activity: Omit<Activity, 'id'>): Promise<Activity> {
  const id = `act_${Date.now()}_${++activityCounter}`;
  const entry: Activity = { id, ...activity };

  if (!redis) {
    mem.activities.unshift(entry);
    if (mem.activities.length > 500) mem.activities.length = 500;
    return entry;
  }

  const score = activity.timestamp;
  const pipeline = redis.pipeline();
  if (activity.owner) {
    pipeline.zadd(K.activity(activity.owner), { score, member: JSON.stringify(entry) });
  }
  pipeline.zadd(K.allActivity, { score, member: JSON.stringify(entry) });
  pipeline.zremrangebyrank(K.allActivity, 0, -501);
  if (activity.owner) {
    pipeline.zremrangebyrank(K.activity(activity.owner), 0, -501);
  }
  await pipeline.exec();
  return entry;
}

export async function getActivities(address?: string, limit = 50): Promise<Activity[]> {
  if (!redis) {
    const filtered = address
      ? mem.activities.filter((a) => a.owner?.toLowerCase() === address.toLowerCase())
      : mem.activities;
    return filtered.slice(0, limit);
  }
  const key = address ? K.activity(address.toLowerCase()) : K.allActivity;
  const raw = await redis.zrange(key, 0, limit - 1, { rev: true }) as string[];
  return raw.map((r) => typeof r === 'string' ? JSON.parse(r) : r);
}

// ---------------------------------------------------------------------------
// Rebalances
// ---------------------------------------------------------------------------

let rebalanceCounter = 0;

export async function logRebalance(record: Omit<RebalanceRecord, 'id'>): Promise<RebalanceRecord> {
  const id = `reb_${Date.now()}_${++rebalanceCounter}`;
  const entry: RebalanceRecord = { id, ...record };
  const addr = record.owner.toLowerCase();

  if (!redis) {
    mem.rebalances.unshift(entry);
    if (mem.rebalances.length > 500) mem.rebalances.length = 500;
    const s = mem.stats.get(addr);
    if (s) {
      s.totalRebalances++;
      if (record.success) s.successfulRebalances++;
      else s.failedRebalances++;
    }
    return entry;
  }

  const score = record.timestamp;
  const pipeline = redis.pipeline();
  pipeline.zadd(K.rebalances(addr), { score, member: JSON.stringify(entry) });
  pipeline.zadd(K.allRebalances, { score, member: JSON.stringify(entry) });
  pipeline.hincrby(K.stats(addr), 'totalRebalances', 1);
  if (record.success) pipeline.hincrby(K.stats(addr), 'successfulRebalances', 1);
  else pipeline.hincrby(K.stats(addr), 'failedRebalances', 1);
  pipeline.zremrangebyrank(K.allRebalances, 0, -501);
  pipeline.zremrangebyrank(K.rebalances(addr), 0, -501);
  await pipeline.exec();
  return entry;
}

export async function getRebalances(address?: string, limit = 50): Promise<RebalanceRecord[]> {
  if (!redis) {
    const filtered = address
      ? mem.rebalances.filter((r) => r.owner.toLowerCase() === address.toLowerCase())
      : mem.rebalances;
    return filtered.slice(0, limit);
  }
  const key = address ? K.rebalances(address.toLowerCase()) : K.allRebalances;
  const raw = await redis.zrange(key, 0, limit - 1, { rev: true }) as string[];
  return raw.map((r) => typeof r === 'string' ? JSON.parse(r) : r);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkRedisConnection(): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
