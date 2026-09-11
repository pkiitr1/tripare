import pino from 'pino';
import { env } from './config/env';

/**
 * One logger shared by the API and the worker. `service` distinguishes the two
 * in aggregated output, since both processes run from the same image.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: process.env.SERVICE_NAME ?? 'api' },
  formatters: {
    level: (label) => ({ level: label }),
  },
});
