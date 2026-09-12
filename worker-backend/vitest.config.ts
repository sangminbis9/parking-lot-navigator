import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export default defineConfig({
  // 예전 로컬 tsc 산출물(.js)이 남아 있어도 최신 .ts 구현을 검증한다.
  plugins: [{
    name: "test-typescript-sources",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return;
      const path = resolve(dirname(importer), source.replace(/\.js$/, ".ts"));
      if (existsSync(path)) return path;
    },
  }],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
