import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "../../backend/src/services/geo.js": fileURLToPath(
        new URL("./src/services/geo.ts", import.meta.url),
      ),
      "../../backend/src/features/localEvents/localEventStructuring.js":
        fileURLToPath(
          new URL(
            "./src/features/localEvents/localEventStructuring.ts",
            import.meta.url,
          ),
        ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
