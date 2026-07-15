import type { Adventure, GameState, LiveCharacter } from "../world/schema.js";

/**
 * Seed a fresh {@link GameState} from an adventure's `start` block and entity
 * definitions. Characters are copied into their live runtime form. Timestamps
 * are injected by the caller (`now`) to keep seeding deterministic in tests.
 */
export function newGameState(adventure: Adventure, now: string): GameState {
  const characters: Record<string, LiveCharacter> = {};
  for (const char of adventure.entities?.characters ?? []) {
    characters[char.id] = {
      location: char.location,
      history: [...char.history],
      state: { ...char.state },
    };
  }

  return {
    adventureId: adventure.meta.id,
    adventureVersion: adventure.meta.version,
    location: adventure.start.room ?? null,
    inventory: [...(adventure.start.inventory ?? [])],
    flags: { ...(adventure.start.flags ?? {}) },
    state: { ...(adventure.start.state ?? {}) },
    characters,
    turn: 0,
    transcript: [],
    createdAt: now,
    updatedAt: now,
  };
}
