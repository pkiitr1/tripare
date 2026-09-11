import { NativeConnection, Worker } from '@temporalio/worker';
import { env } from '../config/env';
import { logger } from '../logger';
import { closeRedis } from '../redis/client';
import * as activities from './activities';

/**
 * Worker process: polls the task queue and runs workflows and activities.
 * Workflow code is bundled into a sandbox, so it may only import deterministic
 * modules - importing ioredis there fails at bundle time.
 */
async function run(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  logger.info(
    { taskQueue: env.TEMPORAL_TASK_QUEUE, address: env.TEMPORAL_ADDRESS },
    'worker started, polling for tasks',
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    worker.shutdown();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  try {
    // Resolves after shutdown() drains in-flight tasks.
    await worker.run();
  } finally {
    await connection.close().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    logger.info('worker stopped');
  }
}

run().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
