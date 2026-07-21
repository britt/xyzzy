import { z } from "zod";
import { isBeatAdvanced, isCharacterBeatAdvanced, isInteractionExhausted } from "../engine/digest.js";
import type { Adventure, GameState } from "../world/schema.js";
import type {
  DetectionBeat,
  DetectionCharacterBeat,
  DetectionContext,
  DetectionExit,
  DetectionInteraction,
} from "./Detector.js";

const TOKEN_SEPARATOR = "/";

/** Encode a `{charId, id}` pair as a single enum-safe token. Character and
 * beat/interaction ids in this codebase are slugs and won't contain `/`. */
export function encodeToken(charId: string, id: string): string {
  return `${charId}${TOKEN_SEPARATOR}${id}`;
}

/** Inverse of {@link encodeToken}: split on the first separator only, so an
 * id containing `/` (unlikely, but not schema-forbidden) round-trips. */
export function decodeToken(token: string): { charId: string; id: string } {
  const i = token.indexOf(TOKEN_SEPARATOR);
  return { charId: token.slice(0, i), id: token.slice(i + 1) };
}

/**
 * Build the per-turn detection schema. `move` is constrained to the current
 * room's exit directions (or "none" -> null); `advancedBeats` to the active beat
 * ids. `advancedCharacterBeats`/`triggeredInteractions` are constrained to
 * composite `charId/id` tokens built from the present characters' candidate
 * beats/interactions. Because the enums come from real state, the model
 * cannot return garbage.
 */
export function buildDetectionSchema(
  exits: DetectionExit[],
  activeBeats: DetectionBeat[],
  characterBeats: DetectionCharacterBeat[] = [],
  interactions: DetectionInteraction[] = [],
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

  const charBeatTokens = characterBeats.map((b) => encodeToken(b.charId, b.beatId));
  const advancedCharacterBeats = (
    charBeatTokens.length > 0
      ? z.array(z.enum(charBeatTokens as [string, ...string[]])).default([])
      : z.array(z.never()).default([])
  ).transform((tokens) =>
    tokens.map((t) => {
      const { charId, id } = decodeToken(t);
      return { charId, beatId: id };
    }),
  );

  const interactionTokens = interactions.map((i) => encodeToken(i.charId, i.interactionId));
  const triggeredInteractions = (
    interactionTokens.length > 0
      ? z.array(z.enum(interactionTokens as [string, ...string[]])).default([])
      : z.array(z.never()).default([])
  ).transform((tokens) =>
    tokens.map((t) => {
      const { charId, id } = decodeToken(t);
      return { charId, interactionId: id };
    }),
  );

  return z.object({ move, advancedBeats, advancedCharacterBeats, triggeredInteractions });
}

/** Assemble the detector's view: current exits (with destinations), active
 * beats, and the beats/interactions belonging to characters present in the
 * current room. */
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

  const characters = adventure.entities?.characters ?? [];
  const present = characters.filter(
    (c) => (state.characters[c.id]?.location ?? c.location) === state.location,
  );

  const characterBeats: DetectionCharacterBeat[] = present.flatMap((c) =>
    (c.beats ?? [])
      .filter((b) => !isCharacterBeatAdvanced(state, c.id, b.id))
      .map((b) => ({
        charId: c.id,
        beatId: b.id,
        trigger: (b.trigger ?? b.description).trim(),
      })),
  );

  const interactions: DetectionInteraction[] = present.flatMap((c) =>
    (c.interactions ?? [])
      .filter((i) => !isInteractionExhausted(state, c.id, i))
      .map((i) => ({
        charId: c.id,
        interactionId: i.id,
        trigger: (i.trigger ?? i.description).trim(),
      })),
  );

  return { input, exits, activeBeats, characterBeats, interactions };
}
