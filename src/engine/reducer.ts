import type { Action } from "../world/actions.js";
import type { GameState, LiveCharacter } from "../world/schema.js";

/**
 * The pure heart of the engine: `(state, action) => state`. Every mutation the
 * model requests flows through here as a validated {@link Action}. The reducer
 * never mutates its input and performs no I/O, no clock reads, and no
 * randomness, so it is fully deterministic and exhaustively testable.
 *
 * Timestamps (`updatedAt`) and the turn counter are owned by the turn loop, not
 * the reducer, to keep this function pure.
 */
export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "moveTo":
      return { ...state, location: action.room };

    case "addItem":
      return state.inventory.includes(action.item)
        ? state
        : { ...state, inventory: [...state.inventory, action.item] };

    case "removeItem":
      return {
        ...state,
        inventory: state.inventory.filter((i) => i !== action.item),
      };

    case "setFlag":
      return { ...state, flags: { ...state.flags, [action.key]: action.value } };

    case "setGameState":
      return { ...state, state: { ...state.state, [action.key]: action.value } };

    case "setCharacterState": {
      const char = getOrCreateCharacter(state, action.charId);
      return withCharacter(state, action.charId, {
        ...char,
        state: { ...char.state, [action.key]: action.value },
      });
    }

    case "appendCharacterHistory": {
      const char = getOrCreateCharacter(state, action.charId);
      return withCharacter(state, action.charId, {
        ...char,
        history: [...char.history, action.summary],
      });
    }

    case "moveCharacter": {
      const char = getOrCreateCharacter(state, action.charId);
      return withCharacter(state, action.charId, {
        ...char,
        location: action.room,
      });
    }

    case "advanceBeat":
      return {
        ...state,
        flags: { ...state.flags, [`beat:${action.beatId}`]: "advanced" },
      };

    case "advanceCharacterBeat": {
      const char = getOrCreateCharacter(state, action.charId);
      return withCharacter(state, action.charId, {
        ...char,
        state: { ...char.state, [`beat:${action.beatId}`]: "advanced" },
      });
    }

    case "triggerInteraction": {
      const char = getOrCreateCharacter(state, action.charId);
      const key = `interaction:${action.interactionId}:count`;
      const count = typeof char.state[key] === "number" ? char.state[key] : 0;
      return withCharacter(state, action.charId, {
        ...char,
        state: { ...char.state, [key]: count + 1 },
      });
    }

    default:
      // Exhaustiveness: adding an Action variant without a case is a type error.
      return assertNever(action);
  }
}

/** Apply a sequence of actions in order. */
export function reduceAll(state: GameState, actions: Action[]): GameState {
  return actions.reduce(reduce, state);
}

function getOrCreateCharacter(
  state: GameState,
  charId: string,
): LiveCharacter {
  return state.characters[charId] ?? { history: [], state: {} };
}

function withCharacter(
  state: GameState,
  charId: string,
  char: LiveCharacter,
): GameState {
  return { ...state, characters: { ...state.characters, [charId]: char } };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled action: ${JSON.stringify(value)}`);
}
