import { z } from "zod";
import { Value } from "./values.js";

/**
 * The fixed set of typed mutations the model may request. Each is exposed to
 * the LLM as a zod-validated tool-call and applied by the pure reducer
 * (`engine/reducer`). Arguments that fail validation are dropped before the
 * reducer runs, so state can never enter an invalid shape. See
 * docs/data-model.md § Actions.
 */

export const MoveTo = z.object({
  type: z.literal("moveTo"),
  room: z.string(),
});

export const AddItem = z.object({
  type: z.literal("addItem"),
  item: z.string(),
});

export const RemoveItem = z.object({
  type: z.literal("removeItem"),
  item: z.string(),
});

export const SetFlag = z.object({
  type: z.literal("setFlag"),
  key: z.string(),
  value: Value,
});

export const SetGameState = z.object({
  type: z.literal("setGameState"),
  key: z.string(),
  value: Value,
});

export const SetCharacterState = z.object({
  type: z.literal("setCharacterState"),
  charId: z.string(),
  key: z.string(),
  value: Value,
});

export const AppendCharacterHistory = z.object({
  type: z.literal("appendCharacterHistory"),
  charId: z.string(),
  summary: z.string(),
});

export const MoveCharacter = z.object({
  type: z.literal("moveCharacter"),
  charId: z.string(),
  room: z.string(),
});

export const AdvanceBeat = z.object({
  type: z.literal("advanceBeat"),
  beatId: z.string(),
});

export const Action = z.discriminatedUnion("type", [
  MoveTo,
  AddItem,
  RemoveItem,
  SetFlag,
  SetGameState,
  SetCharacterState,
  AppendCharacterHistory,
  MoveCharacter,
  AdvanceBeat,
]);

export type Action = z.infer<typeof Action>;
export type ActionType = Action["type"];
