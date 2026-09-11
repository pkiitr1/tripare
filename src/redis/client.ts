import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../logger';
import { READ_HOTELS_IN_RANGE } from './scripts';

/** ioredis with our custom command attached, typed. */
interface RedisWithScripts extends Redis {
  readHotelsInRange(
    metaKey: string,
    zsetKey: string,
    hashKey: string,
    min: string,
    max: string,
  ): Promise<string[] | null>;
}

let client: RedisWithScripts | undefined;

/** One connection per process, created on first use. */
export function getRedis(): RedisWithScripts {
  if (client) return client;

  const instance = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  }) as RedisWithScripts;

  // defineCommand uses EVALSHA and falls back to EVAL on a script-cache miss.
  instance.defineCommand('readHotelsInRange', {
    numberOfKeys: 3,
    lua: READ_HOTELS_IN_RANGE,
  });

  instance.on('error', (err) => logger.error({ err }, 'redis client error'));
  instance.on('connect', () => logger.info('redis connected'));

  client = instance;
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = undefined;
}
