import type { FastifyBaseLogger } from "fastify";

export interface Job {
  stop(): Promise<void>;
}

/**
 * Runs `task` every `intervalMs`, never overlapping with itself (the next run is
 * scheduled only after the current one finishes). stop() waits for a run in progress.
 */
export function startJob(name: string, intervalMs: number, task: () => Promise<unknown>, log: FastifyBaseLogger): Job {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;

  const tick = () => {
    running = task()
      .then(() => undefined)
      .catch((err: unknown) => log.error({ err, job: name }, "job falhou"))
      .finally(() => {
        running = undefined;
        if (!stopped) timer = setTimeout(tick, intervalMs);
      });
  };
  timer = setTimeout(tick, intervalMs);

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
