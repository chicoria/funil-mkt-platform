import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // *.node.test.* files use node:sqlite (Node 22.5+) which Vite 5.x cannot
    // resolve — they are run separately via vitest.node.config.js with pool=forks.
    exclude: ["**/*.node.test.*"],
  },
});
