/**
 * Speculative batching / fan-out engine.
 *
 * "Asking extra questions does not increase latency or cost": every request
 * in a batch is dispatched in parallel through a bounded worker pool, so N
 * independent evaluations finish in ~1 round trip instead of N.
 */

export interface FanOutStats {
  count: number;
  wallMs: number;
  perCallMs: number[];
  maxCallMs: number;
}

const now = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

/** Worker-pool map with bounded concurrency; preserves input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fanOut<R>(
  thunks: ReadonlyArray<() => Promise<R>>,
  limit = 8,
): Promise<{ results: R[]; stats: FanOutStats }> {
  const started = now();
  const perCallMs: number[] = [];
  const results = await mapLimit(thunks, limit, async (thunk) => {
    const t0 = now();
    const value = await thunk();
    perCallMs.push(now() - t0);
    return value;
  });
  const wallMs = now() - started;
  return {
    results,
    stats: {
      count: thunks.length,
      wallMs: Math.round(wallMs * 1000) / 1000,
      perCallMs: perCallMs.map((ms) => Math.round(ms * 1000) / 1000),
      maxCallMs: Math.round(Math.max(0, ...perCallMs) * 1000) / 1000,
    },
  };
}

/**
 * Backpressure router support (module 10, feature #2): a tiny gate that keeps
 * at most `max` operations in flight and queues the rest instead of flooding
 * the backend.
 */
export class BackpressureRouter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly max: number) {}

  async run<R>(fn: () => Promise<R>): Promise<R> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }
}
