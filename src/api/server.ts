import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { env } from '../config/env';
import { logger } from '../logger';
import { closeRedis } from '../redis/client';
import { HttpError } from './errors';
import { healthRouter } from './routes/health';
import { hotelsRouter } from './routes/hotels';
import { suppliersRouter } from './routes/suppliers';

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.use(
    pinoHttp({
      logger,
      // Accept an inbound correlation id if there is one, so a request can be
      // traced across the API, the workflow and the activities.
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use('/api', hotelsRouter);
  app.use(healthRouter);
  app.use(suppliersRouter);

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'NOT_FOUND' });
  });

  // Four arguments: this signature is how Express recognises error middleware.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
      return;
    }

    req.log.error({ err }, 'unhandled error');
    // Never leak an internal message or stack to the client.
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  return app;
}

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'api listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down api');
  server.close(() => {
    void closeRedis().finally(() => process.exit(0));
  });
  // Do not let a hung keep-alive connection block the container forever.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
