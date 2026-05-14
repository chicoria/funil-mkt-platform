import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    // node:sqlite (Node 22.5+) is not bundled by Vite — resolved natively.
    external: ["node:sqlite", "sqlite"],
  },
  test: {
    environment: "node",
    pool: "forks",
    include: ["test/**/*.node.test.*"],
  },
});
