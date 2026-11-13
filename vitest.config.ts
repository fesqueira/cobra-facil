import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration files share one database, so files run one at a time (unit tests take milliseconds anyway).
    fileParallelism: false,
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/server.ts"], reporter: ["text", "lcov"] },
    projects: [
      { test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          // One real PostgreSQL (Testcontainers) shared by all files.
          globalSetup: ["test/integration/global-setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
