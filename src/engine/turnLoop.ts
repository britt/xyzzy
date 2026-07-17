import { Action } from "../world/actions.js";
import type { Adventure, GameState, Room } from "../world/schema.js";
import type { NarratorContext, NarratorModel } from "../llm/NarratorModel.js";
import { buildDigest, isBeatAdvanced } from "./digest.js";
import { reduceAll } from "./reducer.js";
import { appendMessage, windowTranscript } from "./transcript.js";
import { log } from "../util/log.js";

/**
 * Resolve a room/item/character reference to its canonical id. Models routinely
 * pass the display *name* (e.g. "The Great Cavern") instead of the id
 * ("cavern"); storing that name would break every id-based lookup (exits,
 * digest, save). Accept an id as-is, map a case-insensitive name match to its
 * id, and otherwise leave the ref untouched (an improvised entity).
 */
function resolveRef(
  entities: ReadonlyArray<{ id: string; name: string }>,
  ref: string,
): string {
  if (entities.some((e) => e.id === ref)) return ref;
  const byName = entities.find(
    (e) => e.name.toLowerCase() === ref.toLowerCase(),
  );
  return byName ? byName.id : ref;
}

/**
 * Resolve a `moveTo` target. A token matching one of the current room's exit
 * directions (e.g. "north", case-insensitive) maps to that exit's destination
 * room id — so "go north" moves reliably even when the model passes the bare
 * direction instead of naming the room. Anything else falls back to id/name
 * resolution (and an unresolved target is later dropped by the move filter).
 */
function resolveMoveTarget(
  rooms: ReadonlyArray<Room>,
  state: GameState,
  ref: string,
): string {
  const exits = rooms.find((r) => r.id === state.location)?.exits;
  if (exits) {
    const dir = Object.keys(exits).find(
      (d) => d.toLowerCase() === ref.toLowerCase(),
    );
    if (dir) return exits[dir]!;
  }
  return resolveRef(rooms, ref);
}

/** Rewrite an action's entity references to canonical ids. */
export function canonicalizeAction(
  adventure: Adventure,
  state: GameState,
  action: Action,
): Action {
  const rooms = adventure.entities?.rooms ?? [];
  const items = adventure.entities?.items ?? [];
  const chars = adventure.entities?.characters ?? [];
  switch (action.type) {
    case "moveTo":
      return { ...action, room: resolveMoveTarget(rooms, state, action.room) };
    case "addItem":
      return { ...action, item: resolveRef(items, action.item) };
    case "removeItem":
      return { ...action, item: resolveRef(items, action.item) };
    case "moveCharacter":
      return {
        ...action,
        charId: resolveRef(chars, action.charId),
        room: resolveRef(rooms, action.room),
      };
    case "setCharacterState":
      return { ...action, charId: resolveRef(chars, action.charId) };
    case "appendCharacterHistory":
      return { ...action, charId: resolveRef(chars, action.charId) };
    default:
      return action;
  }
}

/**
 * Expand any `advanceBeat` into the beat's declared `effects` followed by the
 * advanceBeat itself, so a beat's state changes apply atomically alongside its
 * flag flip (see docs/data-model.md § StoryBeat). Effects are skipped when the
 * beat is already advanced, so re-advancing is idempotent and never re-runs
 * them. Non-beat actions, unknown beats, and effect-less beats pass through
 * unchanged. The model's own mutations still apply — effects are additive.
 */
export function expandBeatEffects(
  adventure: Adventure,
  state: GameState,
  actions: Action[],
): Action[] {
  return actions.flatMap((action) => {
    if (action.type !== "advanceBeat") return [action];
    if (isBeatAdvanced(state, action.beatId)) return [action];
    const beat = adventure.beats?.find((b) => b.id === action.beatId);
    return [...(beat?.effects ?? []), action];
  });
}

export interface TurnResult {
  narration: string;
  state: GameState;
}

export interface TurnDeps {
  adventure: Adventure;
  model: NarratorModel;
  /** injectable clock for deterministic timestamps in tests */
  clock?: () => string;
  /** number of recent transcript messages to send to the model */
  transcriptWindow?: number;
}

/** Thrown when the model fails to produce any narration, even after a retry. */
export class EmptyNarrationError extends Error {
  constructor() {
    super("Model returned no narration after a retry.");
    this.name = "EmptyNarrationError";
  }
}

const DEFAULT_TRANSCRIPT_WINDOW = 20;

/**
 * Player-facing, authoritative list of the current room's exits and their
 * directions. Returns null when the location is freeform or an improvised room
 * (no authored exits to enumerate), leaving the model's prose to stand.
 */
export function exitsFooter(
  adventure: Adventure,
  state: GameState,
): string | null {
  if (state.location === null) return null;
  const rooms = adventure.entities?.rooms ?? [];
  const room = rooms.find((r) => r.id === state.location);
  if (!room) return null;

  const exits = Object.entries(room.exits ?? {});
  if (exits.length === 0) return "Exits\n- none (no obvious way out)";

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const bullets = exits.map(([dir, target]) => {
    const dest = byId.get(target);
    return dest ? `- ${dir} to ${dest.name}` : `- ${dir}`;
  });
  return `Exits\n${bullets.join("\n")}`;
}

/**
 * Remove any "Exit:"/"Exits: …" run the model emitted (often copied verbatim
 * from the digest, truncated and with internal ids like `[entrance]`). The
 * engine appends its own authoritative exits line, so the model's is redundant
 * and usually wrong.
 */
export function stripProseExits(text: string): string {
  return text
    // Bulleted "Exits" header + bullet lines (the engine's own footer format,
    // in case the model echoes it back from the transcript).
    .replace(/\n*[ \t]*Exits\b[ \t]*:?[ \t]*\n(?:[ \t]*[-*•][^\n]*\n?)+/gi, "\n")
    // Inline "Exits: …" (the digest format the model tends to copy).
    .replace(/\s*Exits?:[^\n]*/gi, "")
    .trim();
}

/** System prompt: premise + tone + the rules that steer tool use. */
export function buildSystemPrompt(adventure: Adventure): string {
  return [
    "You are the game master for a text adventure. Narrate the outcome of the",
    "player's actions vividly and in the second person, staying consistent with",
    "the world facts given in the state digest. Voice any characters in scene.",
    "",
    "Mutate game state ONLY through the provided tools (move, take/drop items,",
    "set flags, update characters, advance beats). Do not invent state changes",
    "in prose without also emitting the matching tool call. Keep narration to a",
    "few sentences.",
    "",
    "MOVEMENT: When the player goes somewhere (e.g. \"go north\", \"enter the",
    "cave\", \"head back\"), you MUST emit a moveTo tool call — pass the exit",
    "direction (e.g. \"north\") or the destination room. Narrating movement in",
    "prose without a moveTo call leaves the player in the same room, which will",
    "contradict the state digest on the next turn.",
    "",
    "EXITS: Do NOT list the room's exits yourself. After your narration the game",
    "automatically appends the complete, authoritative list of exits and their",
    "directions, so just describe the scene and never enumerate exits in prose",
    "(listing only some of them would contradict that authoritative list).",
    "",
    "PREMISE:",
    adventure.premise.trim(),
  ].join("\n");
}

/**
 * Run one turn: build model context (system prompt + digest + windowed
 * transcript), call the model with zod-typed tools, fold the resulting
 * validated actions through the pure reducer, append to the transcript, and
 * return narration + next state.
 *
 * State is derived and returned only after actions validate, so a thrown model
 * error leaves the caller's state untouched (clean rollback, no corrupt save).
 * Invalid tool-call args are dropped before the reducer runs (defense-in-depth).
 */
export async function runTurn(
  deps: TurnDeps,
  state: GameState,
  input: string,
): Promise<TurnResult> {
  const { adventure, model } = deps;
  const now = deps.clock ? deps.clock() : new Date().toISOString();
  const window = deps.transcriptWindow ?? DEFAULT_TRANSCRIPT_WINDOW;

  const context: NarratorContext = {
    systemPrompt: buildSystemPrompt(adventure),
    digest: buildDigest(adventure, state),
    transcript: windowTranscript(state.transcript, window),
    input,
  };

  // Call the model; retry once if it produces no narration.
  let result = await model.generate(context);
  if (result.narration.trim() === "") {
    result = await model.generate(context);
    if (result.narration.trim() === "") throw new EmptyNarrationError();
  }

  // Validate tool-call args; drop anything malformed before the reducer, then
  // canonicalize entity refs (a model may pass a room/item/character name in
  // place of its id).
  const rooms = adventure.entities?.rooms ?? [];
  const roomIds = new Set(rooms.map((r) => r.id));
  // Only constrain movement when the world actually defines rooms; a bare-
  // premise adventure improvises its geography and has nothing to check against.
  const restrictRooms = rooms.length > 0;

  const actions = result.actions
    .map((a) => Action.safeParse(a))
    .filter((r) => r.success)
    .map((r) => canonicalizeAction(adventure, state, r.data))
    .filter((action) => {
      // The model may only move to rooms defined in the game file.
      const target =
        action.type === "moveTo" || action.type === "moveCharacter"
          ? action.room
          : null;
      if (target !== null && restrictRooms && !roomIds.has(target)) {
        log.warn(`rejected move to undefined room "${target}"`, { action });
        return false;
      }
      return true;
    });

  const nextTurn = state.turn + 1;
  // Expand each advanced beat into its authored effects so they apply
  // atomically with the beat flag (idempotent: skipped if already advanced).
  const reduced = reduceAll(state, expandBeatEffects(adventure, state, actions));

  // The engine owns the exits line. Strip any "Exits: …" the model copied from
  // the digest (often truncated and with internal ids), then append the
  // authoritative, complete list so the player always sees every way out.
  const prose = stripProseExits(result.narration);
  const footer = exitsFooter(adventure, reduced);
  const narration = footer
    ? `${prose.trimEnd()}\n\n${footer}`.trim()
    : prose;

  let transcript = appendMessage(reduced.transcript, {
    role: "player",
    text: input,
    turn: nextTurn,
  });
  transcript = appendMessage(transcript, {
    role: "narrator",
    text: narration,
    turn: nextTurn,
  });

  return {
    narration,
    state: { ...reduced, turn: nextTurn, transcript, updatedAt: now },
  };
}
