import { z } from "zod";
import { isBeatAdvanced } from "../engine/digest.js";
import type { Adventure, GameState } from "../world/schema.js";
import type {
  DetectionBeat,
  DetectionContext,
  DetectionExit,
} from "./Detector.js";

/**
 * Build the per-turn detection schema. `move` is constrained to the current
 * room's exit directions (or "none" -> null); `advancedBeats` to the active beat
 * ids. Because the enums come from real state, the model cannot return garbage.
 */
export function buildDetectionSchema(
  exits: DetectionExit[],
  activeBeats: DetectionBeat[],
) {
  const directions = exits.map((e) => e.direction);
  const move = z
    .enum(["none", ...directions] as [string, ...string[]])
    .transform((v) => (v === "none" ? null : v));

  const beatIds = activeBeats.map((b) => b.id);
  const advancedBeats =
    beatIds.length > 0
      ? z.array(z.enum(beatIds as [string, ...string[]])).default([])
      : z.array(z.never()).default([]);

  return z.object({ move, advancedBeats });
}

/** Assemble the detector's view: current exits (with destinations) + active beats. */
export function buildDetectionContext(
  adventure: Adventure,
  state: GameState,
  input: string,
): DetectionContext {
  const rooms = adventure.entities?.rooms ?? [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const current = rooms.find((r) => r.id === state.location);

  const exits = Object.entries(current?.exits ?? {}).map(([direction, target]) => ({
    direction,
    destination: byId.get(target)?.name ?? target,
  }));

  const activeBeats = (adventure.beats ?? [])
    .filter((b) => !isBeatAdvanced(state, b.id))
    .map((b) => ({ id: b.id, trigger: (b.trigger ?? b.description).trim() }));

  return { input, exits, activeBeats };
}
