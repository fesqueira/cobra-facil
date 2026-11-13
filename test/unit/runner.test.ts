import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { startJob } from "../../src/jobs/runner.js";

const log = { error: vi.fn() } as unknown as FastifyBaseLogger;

describe("startJob", () => {
  it("não sobrepõe execuções e stop() espera a execução em andamento", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const job = startJob("teste", 10, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 25)); // slower than the interval
      active--;
      runs++;
    }, log);

    await vi.advanceTimersByTimeAsync(200);
    const stopping = job.stop();
    await vi.advanceTimersByTimeAsync(50);
    await stopping;
    const runsAtStop = runs;
    await vi.advanceTimersByTimeAsync(200);

    expect(maxActive).toBe(1);
    expect(runsAtStop).toBeGreaterThan(3);
    expect(runs).toBe(runsAtStop);
    vi.useRealTimers();
  });

  it("um erro é registrado e o job continua", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const job = startJob("falha", 10, async () => {
      calls++;
      throw new Error("boom");
    }, log);
    await vi.advanceTimersByTimeAsync(35);
    await job.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(log.error).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
