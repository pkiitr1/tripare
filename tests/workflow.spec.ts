import path from 'node:path';
import { WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Offer, SupplierName, SupplierResult } from '../src/domain/types';
import type * as activities from '../src/temporal/activities';
import { hotelSearchWorkflow } from '../src/temporal/workflows';

/**
 * Workflow tests run against Temporal's time-skipping test server: timers and
 * retry backoffs complete instantly, so a retry policy with real-world intervals
 * is still testable in milliseconds.
 *
 * The activities are stubbed here. That is the point of the workflow/activity
 * split - the orchestration logic can be exercised without Redis, without HTTP
 * and without either supplier existing.
 */

const TASK_QUEUE = 'test-hotel-offers';

// An explicit path to the file: Node cannot resolve a directory index written in
// TypeScript, so require.resolve('../src/temporal/workflows') fails under Vitest.
const WORKFLOWS_PATH = path.resolve(process.cwd(), 'src/temporal/workflows/index.ts');

function hotels(supplier: SupplierName, ...rows: [string, number, number][]): SupplierResult {
  return {
    supplier,
    hotels: rows.map(([name, price, commissionPct], i) => ({
      hotelId: `${supplier}-${i}`,
      name,
      price,
      city: 'delhi',
      commissionPct,
    })),
  };
}

describe('hotelSearchWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  /** Runs the workflow with a specific set of activity stubs. */
  async function run(
    stubs: Partial<typeof activities>,
    city = 'delhi',
  ): Promise<{ offers: Offer[]; degraded: boolean; suppliersFailed: SupplierName[] }> {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: stubs,
    });

    return worker.runUntil(
      env.client.workflow.execute(hotelSearchWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: `test-${city}-${Math.random()}`,
        args: [{ city }],
      }),
    );
  }

  it('calls both suppliers and returns the cheaper offer per hotel', async () => {
    const cached: Offer[][] = [];

    const result = await run({
      fetchSupplierHotels: async ({ supplier }) =>
        supplier === 'Supplier A'
          ? hotels('Supplier A', ['Holtin', 6000, 10], ['Radison', 5900, 13])
          : hotels('Supplier B', ['Holtin', 5340, 20], ['Radison', 6100, 25]),
      cacheHotels: async ({ offers }) => {
        cached.push(offers);
      },
    });

    expect(result.offers).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
    ]);
    expect(result.degraded).toBe(false);
    // The result must reach Redis before the workflow returns it to the caller.
    expect(cached).toEqual([result.offers]);
  });

  it('still returns the surviving supplier when the other one is down', async () => {
    const result = await run({
      fetchSupplierHotels: async ({ supplier }) => {
        if (supplier === 'Supplier A') throw new Error('connection refused');
        return hotels('Supplier B', ['Oberoy', 9100, 18]);
      },
      cacheHotels: async () => undefined,
    });

    expect(result.offers).toEqual([
      { name: 'Oberoy', price: 9100, supplier: 'Supplier B', commissionPct: 18 },
    ]);
    expect(result.degraded).toBe(true);
    expect(result.suppliersFailed).toEqual(['Supplier A']);
  });

  it('retries a flaky supplier and succeeds on a later attempt', async () => {
    let attempts = 0;

    const result = await run({
      fetchSupplierHotels: async ({ supplier }) => {
        if (supplier === 'Supplier B') return hotels('Supplier B', ['Ibis', 3400, 9]);
        attempts += 1;
        if (attempts < 3) throw new Error('supplier A returned 503');
        return hotels('Supplier A', ['Ibis', 3200, 8]);
      },
      cacheHotels: async () => undefined,
    });

    expect(attempts).toBe(3);
    expect(result.degraded).toBe(false);
    expect(result.offers[0]).toMatchObject({ supplier: 'Supplier A', price: 3200 });
  });

  it('fails the workflow only when every supplier is unreachable', async () => {
    const error = await run({
      fetchSupplierHotels: async () => {
        throw new Error('connection refused');
      },
      cacheHotels: async () => undefined,
    }).catch((err: unknown) => err);

    // Temporal wraps a workflow failure in an envelope whose own message is the
    // generic "Workflow execution failed". What the workflow actually threw lives
    // on .cause, and the  is the string the API layer maps to a 503.
    expect(error).toBeInstanceOf(WorkflowFailedError);
    const cause = (error as WorkflowFailedError).cause as { type?: string; message?: string };
    expect(cause.type).toBe('AllSuppliersUnavailable');
    expect(cause.message).toMatch(/No supplier could be reached/);
  });

  it('caches an empty result for a city neither supplier serves', async () => {
    const cached: Offer[][] = [];

    const result = await run(
      {
        fetchSupplierHotels: async ({ supplier }) => ({ supplier, hotels: [] }),
        cacheHotels: async ({ offers }) => {
          cached.push(offers);
        },
      },
      'atlantis',
    );

    expect(result.offers).toEqual([]);
    // Caching the empty answer is what stops an unknown city from re-running the
    // workflow on every request.
    expect(cached).toEqual([[]]);
  });
});
