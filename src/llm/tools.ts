import { z } from "zod";
import { Action, type ActionType } from "../world/actions.js";
import { Value } from "../world/schema.js";

/**
 * Per-action argument schemas (the action shape without its `type` discriminant)
 * plus a description. The registry adapts these to AI SDK `tool()` definitions;
 * keeping them provider-agnostic here makes reconstruction unit-testable. The
 * tool name is the action `type`.
 */
export interface ActionToolDef {
  description: string;
  /** zod schema for the tool's arguments (excludes `type`) */
  parameters: z.ZodTypeAny;
}

export const ACTION_TOOLS: Record<ActionType, ActionToolDef> = {
  moveTo: {
    description: "Move the player to a room.",
    parameters: z.object({ room: z.string() }),
  },
  addItem: {
    description: "Add an item to the player's inventory.",
    parameters: z.object({ item: z.string() }),
  },
  removeItem: {
    description: "Remove an item from the player's inventory.",
    parameters: z.object({ item: z.string() }),
  },
  setFlag: {
    description: "Set an engine/beat flag.",
    parameters: z.object({ key: z.string(), value: Value }),
  },
  setGameState: {
    description: "Set a game-wide state value.",
    parameters: z.object({ key: z.string(), value: Value }),
  },
  setCharacterState: {
    description: "Set a value in a character's state bag.",
    parameters: z.object({
      charId: z.string(),
      key: z.string(),
      value: Value,
    }),
  },
  appendCharacterHistory: {
    description: "Append a short summary to a character's history.",
    parameters: z.object({ charId: z.string(), summary: z.string() }),
  },
  moveCharacter: {
    description: "Move a character to a room.",
    parameters: z.object({ charId: z.string(), room: z.string() }),
  },
  advanceBeat: {
    description: "Mark a story beat as advanced.",
    parameters: z.object({ beatId: z.string() }),
  },
};

/** All action tool names (= action types). */
export const ACTION_NAMES = Object.keys(ACTION_TOOLS) as ActionType[];

/**
 * Reconstruct a validated {@link Action} from a tool name + raw args. Returns
 * `null` if the name is unknown or the args fail validation — the caller drops
 * `null`s so the reducer never sees an invalid action (defense-in-depth).
 */
export function toAction(name: string, args: unknown): Action | null {
  const candidate = { type: name, ...(args as Record<string, unknown>) };
  const parsed = Action.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
