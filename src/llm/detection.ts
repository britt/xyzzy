import { z } from "zod";
import type { DetectionBeat, DetectionExit } from "./Detector.js";

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
