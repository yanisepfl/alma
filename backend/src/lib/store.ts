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
// Client
// ---------------------------------------------------------------------------

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

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
  await redis.sadd(K.users, addr);
  const exists = await redis.exists(K.stats(addr));
  if (!exists) {
    await redis.hset(K.stats(addr), {
      address: addr,
      positionCount: 0,
      totalRebalances: 0,
      successfulRebalances: 0,
      failedRebalances: 0,
      lastScanAt: 0,
      registeredAt: Date.now(),
    });
  }
}

export async function getRegisteredUsers(): Promise<string[]> {
  return (await redis.smembers(K.users)) as string[];
}

export async function getUserStats(address: string): Promise<UserStats | null> {
  const data = await redis.hgetall(K.stats(address.toLowerCase()));
  if (!data || Object.keys(data).length === 0) return null;
  return data as unknown as UserStats;
}

export async function updateUserStats(address: string, updates: Partial<UserStats>): Promise<void> {
  await redis.hset(K.stats(address.toLowerCase()), updates as Record<string, any>);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

let activityCounter = 0;

export async function logActivity(activity: Omit<Activity, 'id'>): Promise<Activity> {
  const id = `act_${Date.now()}_${++activityCounter}`;
  const entry: Activity = { id, ...activity };
  const score = activity.timestamp;

  // Store per-user and globally
  const pipeline = redis.pipeline();
  if (activity.owner) {
    pipeline.zadd(K.activity(activity.owner), { score, member: JSON.stringify(entry) });
  }
  pipeline.zadd(K.allActivity, { score, member: JSON.stringify(entry) });

  // Trim to last 500 entries
  pipeline.zremrangebyrank(K.allActivity, 0, -501);
  if (activity.owner) {
    pipeline.zremrangebyrank(K.activity(activity.owner), 0, -501);
  }

  await pipeline.exec();
  return entry;
}

export async function getActivities(address?: string, limit = 50): Promise<Activity[]> {
  const key = address ? K.activity(address.toLowerCase()) : K.allActivity;
  const raw = await redis.zrange(key, 0, limit - 1, { rev: true }) as string[];
  return raw.map((r) => {
    if (typeof r === 'string') return JSON.parse(r);
    return r;
  });
}

// ---------------------------------------------------------------------------
// Rebalances
// ---------------------------------------------------------------------------

let rebalanceCounter = 0;

export async function logRebalance(record: Omit<RebalanceRecord, 'id'>): Promise<RebalanceRecord> {
  const id = `reb_${Date.now()}_${++rebalanceCounter}`;
  const entry: RebalanceRecord = { id, ...record };
  const score = record.timestamp;
  const addr = record.owner.toLowerCase();

  const pipeline = redis.pipeline();
  pipeline.zadd(K.rebalances(addr), { score, member: JSON.stringify(entry) });
  pipeline.zadd(K.allRebalances, { score, member: JSON.stringify(entry) });

  // Update stats
  pipeline.hincrby(K.stats(addr), 'totalRebalances', 1);
  if (record.success) {
    pipeline.hincrby(K.stats(addr), 'successfulRebalances', 1);
  } else {
    pipeline.hincrby(K.stats(addr), 'failedRebalances', 1);
  }

  // Trim to last 500
  pipeline.zremrangebyrank(K.allRebalances, 0, -501);
  pipeline.zremrangebyrank(K.rebalances(addr), 0, -501);

  await pipeline.exec();
  return entry;
}

export async function getRebalances(address?: string, limit = 50): Promise<RebalanceRecord[]> {
  const key = address ? K.rebalances(address.toLowerCase()) : K.allRebalances;
  const raw = await redis.zrange(key, 0, limit - 1, { rev: true }) as string[];
  return raw.map((r) => {
    if (typeof r === 'string') return JSON.parse(r);
    return r;
  });
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
