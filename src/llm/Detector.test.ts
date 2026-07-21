import { describe, expect, it } from "vitest";
import { FakeDetector, type Detection } from "./Detector.js";

describe("FakeDetector", () => {
  it("replays scripted detections in order, then repeats the last", async () => {
    const a: Detection = {
      move: "north",
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    };
    const b: Detection = {
      move: null,
      advancedBeats: ["find-light"],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    };
    const d = new FakeDetector([a, b]);

    expect(
      await d.detect({ input: "go north", exits: [], activeBeats: [], characterBeats: [], interactions: [] }),
    ).toEqual(a);
    expect(
      await d.detect({ input: "light lantern", exits: [], activeBeats: [], characterBeats: [], interactions: [] }),
    ).toEqual(b);
    expect(
      await d.detect({ input: "again", exits: [], activeBeats: [], characterBeats: [], interactions: [] }),
    ).toEqual(b);
  });

  it("defaults to an empty detection when unscripted", async () => {
    const d = new FakeDetector();
    expect(
      await d.detect({ input: "x", exits: [], activeBeats: [], characterBeats: [], interactions: [] }),
    ).toEqual({
      move: null,
      advancedBeats: [],
      advancedCharacterBeats: [],
      triggeredInteractions: [],
    });
  });
});
