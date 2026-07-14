import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  // Preserve the CLI shebang so `dist/cli/index.js` is directly executable.
  banner: ({ format }) => (format === "esm" ? {} : {}),
});
