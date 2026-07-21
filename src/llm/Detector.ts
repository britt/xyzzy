/** One exit visible to the detector: direction + destination display name. */
export interface DetectionExit {
  direction: string;
  destination: string;
}

/** One active beat visible to the detector: id + its trigger text. */
export interface DetectionBeat {
  id: string;
  trigger: string;
}

/** One active character beat visible to the detector: character + beat id + trigger. */
export interface DetectionCharacterBeat {
  charId: string;
  beatId: string;
  trigger: string;
}

/** One active character interaction visible to the detector. */
export interface DetectionInteraction {
  charId: string;
  interactionId: string;
  trigger: string;
}

export interface DetectionContext {
  input: string;
  exits: DetectionExit[];
  activeBeats: DetectionBeat[];
  /** Beats belonging to characters present in the current room. */
  characterBeats: DetectionCharacterBeat[];
  /** Interactions belonging to characters present in the current room. */
  interactions: DetectionInteraction[];
}

/** The structured facts a detection extracts from the player's input. */
export interface Detection {
  /** exit direction (or null) the player is trying to take */
  move: string | null;
  /** ids of active beats whose triggers the input now satisfies */
  advancedBeats: string[];
  /** character beats whose triggers the input now satisfies */
  advancedCharacterBeats: { charId: string; beatId: string }[];
  /** character interactions whose triggers the input now satisfies */
  triggeredInteractions: { charId: string; interactionId: string }[];
}

export interface Detector {
  detect(ctx: DetectionContext): Promise<Detection>;
}

/** Deterministic detector for tests: replays a scripted queue, repeats the last. */
export class FakeDetector implements Detector {
  private readonly queue: Detection[];
  private index = 0;
  public readonly calls: DetectionContext[] = [];

  constructor(scripted: Detection[] = []) {
    this.queue = scripted;
  }

  async detect(ctx: DetectionContext): Promise<Detection> {
    this.calls.push(ctx);
    const next =
      this.queue[this.index] ??
      this.queue[this.queue.length - 1] ??
      ({
        move: null,
        advancedBeats: [],
        advancedCharacterBeats: [],
        triggeredInteractions: [],
      } satisfies Detection);
    if (this.index < this.queue.length) this.index++;
    return next;
  }
}
