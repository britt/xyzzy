import { z } from "zod";

/**
 * The `world/` schemas are the single source of truth for every structure xyzzy
 * reads and writes. Loader, validator, scaffolder, engine, and llm layers all
 * derive their types from here. See docs/data-model.md.
 */

/** Open scalar value used throughout author-defined `state`/`flags` bags. */
export const Value = z.union([z.string(), z.number(), z.boolean()]);
export type Value = z.infer<typeof Value>;

const ValueBag = z.record(z.string(), Value);

// ---------------------------------------------------------------------------
// Adventure (authored content)
// ---------------------------------------------------------------------------

export const Meta = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().optional(),
  version: z.string().min(1),
});
export type Meta = z.infer<typeof Meta>;

export const Room = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** direction → target room id, e.g. `{ north: "hallway" }` */
  exits: z.record(z.string(), z.string()).optional(),
});
export type Room = z.infer<typeof Room>;

export const Item = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /** room id where the item starts, or a character id holding it */
  location: z.string().optional(),
});
export type Item = z.infer<typeof Item>;

export const Character = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  persona: z.string().min(1),
  location: z.string().optional(),
  history: z.array(z.string()).default([]),
  state: ValueBag.default({}),
});
export type Character = z.infer<typeof Character>;

export const Entities = z.object({
  rooms: z.array(Room).optional(),
  items: z.array(Item).optional(),
  characters: z.array(Character).optional(),
});
export type Entities = z.infer<typeof Entities>;

export const Start = z.object({
  room: z.string().optional(),
  inventory: z.array(z.string()).optional(),
  flags: ValueBag.optional(),
  state: ValueBag.optional(),
});
export type Start = z.infer<typeof Start>;

export const StoryBeat = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** optional trigger notes surfaced to the model */
  trigger: z.string().optional(),
});
export type StoryBeat = z.infer<typeof StoryBeat>;

export const Adventure = z.object({
  meta: Meta,
  premise: z.string().min(1),
  entities: Entities.optional(),
  start: Start,
  beats: z.array(StoryBeat).optional(),
});
export type Adventure = z.infer<typeof Adventure>;

// ---------------------------------------------------------------------------
// GameState (running save)
// ---------------------------------------------------------------------------

export const Message = z.object({
  role: z.enum(["player", "narrator"]),
  text: z.string(),
  turn: z.number().int().nonnegative(),
});
export type Message = z.infer<typeof Message>;

export const LiveCharacter = z.object({
  location: z.string().optional(),
  history: z.array(z.string()).default([]),
  state: ValueBag.default({}),
});
export type LiveCharacter = z.infer<typeof LiveCharacter>;

export const GameState = z.object({
  adventureId: z.string(),
  adventureVersion: z.string(),
  location: z.string().nullable(),
  inventory: z.array(z.string()),
  flags: ValueBag,
  state: ValueBag,
  characters: z.record(z.string(), LiveCharacter),
  turn: z.number().int().nonnegative(),
  transcript: z.array(Message),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GameState = z.infer<typeof GameState>;
