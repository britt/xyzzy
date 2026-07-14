import type { Message } from "../world/schema.js";

/**
 * The narrow interface the engine depends on. Everything above `llm/` talks to
 * this, never a concrete SDK, so tests inject a fake. Raw tool-call args are
 * returned unvalidated (`unknown[]`); the engine validates them against the
 * Action schema before they reach the reducer.
 */
export interface NarratorContext {
  systemPrompt: string;
  /** authoritative state digest for this turn */
  digest: string;
  /** windowed recent transcript */
  transcript: Message[];
  /** the player's raw input for this turn */
  input: string;
}

export interface NarratorResult {
  /** final narration text shown to the player */
  narration: string;
  /** requested mutations as raw tool-call args, validated downstream */
  actions: unknown[];
}

export interface NarratorModel {
  generate(context: NarratorContext): Promise<NarratorResult>;
}

/**
 * Deterministic model for tests: replays a scripted queue of results, one per
 * turn. Exercises the full turn loop + reducer with zero network. When the
 * queue is exhausted it repeats the last result (or returns empty narration).
 */
export class FakeNarratorModel implements NarratorModel {
  private readonly queue: NarratorResult[];
  private index = 0;
  public readonly calls: NarratorContext[] = [];

  constructor(scripted: NarratorResult[] = []) {
    this.queue = scripted;
  }

  async generate(context: NarratorContext): Promise<NarratorResult> {
    this.calls.push(context);
    const next =
      this.queue[this.index] ??
      this.queue[this.queue.length - 1] ??
      ({ narration: "", actions: [] } satisfies NarratorResult);
    if (this.index < this.queue.length) this.index++;
    return next;
  }
}
