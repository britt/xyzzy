import type { Adventure, GameState, Value } from "../world/schema.js";

/** A beat is active until its `beat:<id>` flag reads "advanced". */
export function isBeatAdvanced(state: GameState, beatId: string): boolean {
  return state.flags[`beat:${beatId}`] === "advanced";
}

function renderBag(bag: Record<string, Value>): string {
  const entries = Object.entries(bag);
  if (entries.length === 0) return "(none)";
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
}

/**
 * Build the compact, authoritative "state digest" fed to the model each turn:
 * current room + exits, entities present, inventory, relevant character
 * state/history, active beats, and game-wide state. Regenerated from
 * {@link GameState} every turn, so the transcript can be windowed without
 * losing game facts.
 */
export function buildDigest(adventure: Adventure, state: GameState): string {
  const rooms = adventure.entities?.rooms ?? [];
  const items = adventure.entities?.items ?? [];
  const characters = adventure.entities?.characters ?? [];

  const lines: string[] = [];

  // --- Location ---
  const room = rooms.find((r) => r.id === state.location);
  if (state.location === null) {
    lines.push("Location: (freeform — not yet fixed to a room)");
  } else if (room) {
    lines.push(`Location: ${room.name} [${room.id}]`);
    lines.push(`  ${room.description.trim()}`);
    const exits = Object.entries(room.exits ?? {});
    lines.push(
      exits.length
        ? `Exits: ${exits.map(([d, t]) => `${d} → ${t}`).join(", ")}`
        : "Exits: (none)",
    );
  } else {
    lines.push(`Location: ${state.location} (improvised — not authored)`);
  }

  // --- Items present in the room (not carried) ---
  const here = items.filter(
    (i) => i.location === state.location && !state.inventory.includes(i.id),
  );
  if (here.length) {
    lines.push(
      `Items here: ${here.map((i) => `${i.name} [${i.id}]`).join(", ")}`,
    );
  }

  // --- Characters present ---
  const present = characters.filter(
    (c) => (state.characters[c.id]?.location ?? c.location) === state.location,
  );
  if (present.length) {
    lines.push("Characters here:");
    for (const c of present) {
      const live = state.characters[c.id];
      const st = live ? renderBag(live.state) : renderBag(c.state);
      lines.push(`  - ${c.name} [${c.id}] — ${c.persona.trim()}`);
      lines.push(`    state: ${st}`);
      const history = live?.history ?? c.history;
      if (history.length) {
        lines.push(`    history: ${history.join("; ")}`);
      }
    }
  }

  // --- Player ---
  lines.push(
    `Inventory: ${state.inventory.length ? state.inventory.join(", ") : "(empty)"}`,
  );
  lines.push(`Flags: ${renderBag(state.flags)}`);
  lines.push(`Game state: ${renderBag(state.state)}`);

  // --- Active beats ---
  const active = (adventure.beats ?? []).filter(
    (b) => !isBeatAdvanced(state, b.id),
  );
  if (active.length) {
    lines.push("Active goals:");
    for (const b of active) lines.push(`  - [${b.id}] ${b.description.trim()}`);
  }

  return lines.join("\n");
}
