import { describe, expect, it } from "vitest";
import { FakeNarratorModel } from "./NarratorModel.js";

const ctx = {
  systemPrompt: "sys",
  digest: "digest",
  transcript: [],
  input: "look",
};

describe("FakeNarratorModel", () => {
  it("replays scripted results in order and records calls", async () => {
    const model = new FakeNarratorModel([
      { narration: "first", actions: [{ type: "moveTo", room: "a" }] },
      { narration: "second", actions: [] },
    ]);

    expect((await model.generate(ctx)).narration).toBe("first");
    expect((await model.generate(ctx)).narration).toBe("second");
    expect(model.calls).toHaveLength(2);
  });

  it("repeats the last result once the queue is exhausted", async () => {
    const model = new FakeNarratorModel([{ narration: "only", actions: [] }]);
    await model.generate(ctx);
    expect((await model.generate(ctx)).narration).toBe("only");
  });

  it("returns empty narration with no script", async () => {
    const model = new FakeNarratorModel();
    const result = await model.generate(ctx);
    expect(result).toEqual({ narration: "", actions: [] });
  });
});
