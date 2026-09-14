import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // `.tsx` as well as `.ts`, because a file the runner does not collect does
    // not fail — it is absent, and the suite goes green with a broken test
    // sitting on disk. Proven by dropping an `expect(1).toBe(2)` into a
    // `.test.tsx`: 130 files passed and nothing mentioned it.
    //
    // The environment here is "node", so a `.test.tsx` that actually renders
    // needs jsdom. That is a loud failure, which is the point of the change.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
