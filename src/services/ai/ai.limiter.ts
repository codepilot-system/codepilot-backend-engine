import { createClient } from 'redis';
import { ENV } from '../../config/env.config';
import { ModelStatus } from './ai.types';
import { ApiError } from '../../lib/ApiError';

export const LOCAL_MODELS = [
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'qwen/qwen3.6-27b',
] as const;

export const REPO_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'groq/compound',
  'qwen/qwen3-32b',
  'openai/gpt-oss-120b',
] as const;

export const MODELS_BY_SCAN_TYPE: Record<'local' | 'repo', readonly string[]> = {
  local: LOCAL_MODELS,
  repo: REPO_MODELS,
};

export const SUMMARY_MODEL = 'groq/compound-mini';

export const MODEL_REQUEST_LIMITS: Record<string, number> = {
  'llama-3.1-8b-instant': 50,
  'qwen/qwen3-32b': 30,
  'qwen/qwen3.6-27b': 30,
  'openai/gpt-oss-120b': 10,
  'openai/gpt-oss-20b': 20,
  'meta-llama/llama-4-scout-17b-16e-instruct': 30,
  'groq/compound': 15,
};

export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'llama-3.1-8b-instant': 40_000,
  'qwen/qwen3-32b': 50_000,
  'qwen/qwen3.6-27b': 40_000,
  'openai/gpt-oss-120b': 15_000,
  'openai/gpt-oss-20b': 30_000,
  'meta-llama/llama-4-scout-17b-16e-instruct': 60_000,
  'groq/compound': 200_000,
};

export const COOLDOWN_MESSAGES = {
  daily: 'experiencing daily capacity limits or is currently unavailable. Please try again tomorrow',
  minute: 'currently experiencing high traffic. Please wait a minute',
} as const;

// Intentionally "fail open" — if Redis is unavailable, quotas and circuit breakers
// are bypassed so users can still get AI analysis, just without rate protection.
export const redisClient = createClient({ url: ENV.REDIS_URL });
redisClient.on('error', (error) => { console.error('[Redis] Client error:', error); });
redisClient.connect().catch((error) => { console.error('[Redis] Connection failed:', error); });

function getSecsUntilMidnight(): number {
  const now = new Date();
  return Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000
  );
}

export async function checkDailyQuota(entityId: string, entityType: 'user' | 'project', model: string, estimatedTokens: number): Promise<boolean> {
  const baseReq = MODEL_REQUEST_LIMITS[model] ?? 20;
  const baseTok = MODEL_TOKEN_LIMITS[model] ?? 20_000;
  const reqLimit = entityType === 'project' ? Math.max(1, Math.floor(baseReq / 2)) : baseReq;
  const tokLimit = entityType === 'project' ? baseTok * 2 : baseTok;

  const [reqs, toks] = await redisClient.mGet([
    `quota:req:${entityType}:${entityId}:${model}`,
    `quota:tok:${entityType}:${entityId}:${model}`,
  ]).catch((error) => {
    console.error(`[Redis] Failed to check daily quota for ${model} (failing open):`, error);
    return [null, null] as (string | null)[];
  });

  if (reqs && parseInt(reqs, 10) >= reqLimit) return false;
  if (toks && parseInt(toks, 10) + estimatedTokens > tokLimit) return false;
  return true;
}

export async function recordDailyQuota(entityId: string, entityType: 'user' | 'project', model: string, tokensUsed: number): Promise<void> {
  const ttl = getSecsUntilMidnight();
  const reqKey = `quota:req:${entityType}:${entityId}:${model}`;
  const tokKey = `quota:tok:${entityType}:${entityId}:${model}`;
  // NX flag on expire: only sets TTL if key has none yet, preserving the original midnight reset
  const multi = redisClient.multi();
  multi.incr(reqKey);
  multi.expire(reqKey, ttl, 'NX');
  if (tokensUsed > 0) {
    multi.incrBy(tokKey, tokensUsed);
    multi.expire(tokKey, ttl, 'NX');
  }
  await multi.exec().catch((error) => {
    console.error('[Redis] Failed to record daily quota:', error);
  });
}

export async function tripCircuitBreaker(model: string, error: unknown): Promise<void> {
  const err = error as { status?: number; message?: string };
  const msg = err?.message?.toLowerCase() ?? '';
  let cooldownSecs = 10;
  let isDaily = false;

  if (err?.status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    if (msg.includes('per day')) {
      cooldownSecs = getSecsUntilMidnight();
      isDaily = true;
    } else {
      cooldownSecs = 60;
    }
  } else if (err?.status === 404 || msg.includes('model not found') || msg.includes('does not exist')) {
    cooldownSecs = getSecsUntilMidnight();
    isDaily = true;
  } else if (err?.status && err.status >= 500) {
    cooldownSecs = 60;
  }

  await redisClient
    .set(`circuit_breaker:${model}`, isDaily ? 'daily' : 'minute', { EX: cooldownSecs, NX: true })
    .catch(console.error);
}

export async function getCircuitBreakerStatus(model: string): Promise<'daily' | 'minute' | null> {
  return redisClient.get(`circuit_breaker:${model}`).catch((error) => {
    console.error(`[Redis] Failed to check circuit breaker for ${model}:`, error);
    return null;
  }) as Promise<'daily' | 'minute' | null>;
}

export async function getModelStatuses(scanType: 'local' | 'repo', entityId?: string): Promise<ModelStatus[]> {
  const entityType = scanType === 'local' ? 'user' : 'project';
  const models = MODELS_BY_SCAN_TYPE[scanType];
  const keys: string[] = [];
  for (const model of models) {
    keys.push(`circuit_breaker:${model}`);
    if (entityId) keys.push(`quota:req:${entityType}:${entityId}:${model}`, `quota:tok:${entityType}:${entityId}:${model}`);
  }

  const values = await redisClient.mGet(keys).catch(() => {
    throw new ApiError('Model status service is temporarily unavailable. Please try again later.', 503);
  });

  const keyValueMap = new Map<string, string | null>(
    keys.map((k, idx) => [k, values[idx] ?? null])
  );

  return models.map((model) => {
    const cb = keyValueMap.get(`circuit_breaker:${model}`) ?? null;
    const entityReqs = entityId ? keyValueMap.get(`quota:req:${entityType}:${entityId}:${model}`) ?? null : null;
    const entityToks = entityId ? keyValueMap.get(`quota:tok:${entityType}:${entityId}:${model}`) ?? null : null;

    if (cb) {
      return {
        model,
        isAvailable: false,
        status: 'Down',
        reason: COOLDOWN_MESSAGES[cb === 'daily' ? 'daily' : 'minute'],
      };
    }

    const baseReq = MODEL_REQUEST_LIMITS[model] ?? 20;
    const baseTok = MODEL_TOKEN_LIMITS[model] ?? 20_000;
    const reqLimit = entityType === 'project' ? Math.max(1, Math.floor(baseReq / 2)) : baseReq;
    const tokLimit = entityType === 'project' ? baseTok * 2 : baseTok;

    const outOfQuota = entityId && (
      (entityReqs !== null && parseInt(entityReqs, 10) >= reqLimit) ||
      (entityToks !== null && parseInt(entityToks, 10) >= tokLimit)
    );

    if (outOfQuota) {
      return { model, isAvailable: false, status: 'Out of Quota', reason: null };
    }

    return { model, isAvailable: true, status: 'Active', reason: null };
  });
}
