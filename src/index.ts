/**
 * Public library surface for xyzzy. The CLI (`src/cli`) is the primary
 * entrypoint; these exports let the engine, schemas, and llm layer be embedded
 * programmatically.
 */
export * from "./world/index.js";
export * from "./engine/index.js";
export * from "./llm/index.js";
export * from "./config/index.js";
export { NotImplementedError, notImplemented } from "./util/notImplemented.js";
export { log, logPath, logDir, describeError, userMessage } from "./util/log.js";
