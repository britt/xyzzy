import { describe, expect, it } from "vitest";
import { DETECTION_OWNED_ACTIONS } from "./actions.js";

describe("DETECTION_OWNED_ACTIONS", () => {
  it("lists exactly the action types the detection pre-pass owns", () => {
    expect([...DETECTION_OWNED_ACTIONS].sort()).toEqual(
      [
        "moveTo",
        "advanceBeat",
        "advanceCharacterBeat",
        "triggerInteraction",
      ].sort(),
    );
  });
});
