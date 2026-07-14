import { notImplemented } from "../util/notImplemented.js";

/**
 * Expose the reducer {@link Action}s to the AI SDK as zod-typed tools. Each
 * action variant becomes a named tool whose parameters are its zod schema; the
 * SDK's multi-step tool loop lets the model narrate and emit several mutations
 * in one turn.
 *
 * TODO: build a `Record<string, Tool>` (AI SDK `tool({ parameters, execute })`)
 * from the Action variants, collecting validated calls for the engine to fold.
 */
export function buildActionTools(): Record<string, unknown> {
  return notImplemented("llm/tools.buildActionTools");
}
