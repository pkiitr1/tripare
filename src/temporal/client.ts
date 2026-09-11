import { Client, Connection, WorkflowFailedError } from '@temporalio/client';
import { env } from '../config/env';
import { logger } from '../logger';
import type { HotelSearchResult } from './workflows';
import { hotelSearchWorkflow } from './workflows';

let clientPromise: Promise<Client> | undefined;

/** Lazily-created singleton connection, shared by every request. */
async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({
        address: env.TEMPORAL_ADDRESS,
        connectTimeout: '10s',
      });
      logger.info({ address: env.TEMPORAL_ADDRESS }, 'connected to temporal');
      return new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
    })().catch((err) => {
      // Do not cache a failed connection - the next request should retry.
      clientPromise = undefined;
      throw err;
    });
  }
  return clientPromise;
}

/** Raised when every supplier was unreachable, so there is no answer at all. */
export class AllSuppliersUnavailableError extends Error {
  constructor(city: string) {
    super(`No supplier could be reached for city "${city}"`);
    this.name = 'AllSuppliersUnavailableError';
  }
}

/**
 * Runs the search workflow and waits for it. The city-derived id plus USE_EXISTING
 * means concurrent requests for one city attach to a single run.
 */
export async function runHotelSearch(city: string, requestId: string): Promise<HotelSearchResult> {
  const client = await getTemporalClient();

  const handle = await client.workflow.start(hotelSearchWorkflow, {
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowId: `hotels:${city}`,
    workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    workflowIdConflictPolicy: 'USE_EXISTING',
    workflowExecutionTimeout: '1 minute',
    args: [{ city, requestId }],
  });

  logger.debug(
    { workflowId: handle.workflowId, runId: handle.firstExecutionRunId },
    'workflow started',
  );

  try {
    return await handle.result();
  } catch (err) {
    // The real failure is on .cause; map it to a domain error the route turns into a 503.
    if (err instanceof WorkflowFailedError) {
      const cause = err.cause as { type?: string } | undefined;
      if (cause?.type === 'AllSuppliersUnavailable') {
        throw new AllSuppliersUnavailableError(city);
      }
    }
    throw err;
  }
}

/** Used by /health to report whether the Temporal frontend is reachable. */
export async function pingTemporal(): Promise<boolean> {
  const client = await getTemporalClient();
  await client.connection.workflowService.getSystemInfo({});
  return true;
}
