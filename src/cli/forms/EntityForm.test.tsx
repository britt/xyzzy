import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { EntityForm, type FormFieldSpec } from "./EntityForm.js";

const ENTER = "\r";

const tick = () => new Promise((r) => setTimeout(r, 20));

function mount(fields: FormFieldSpec[]) {
  const onDone = vi.fn();
  const r = render(<EntityForm fields={fields} onDone={onDone} />);
  return { ...r, onDone };
}

async function keys(
  stdin: { write: (s: string) => void },
  ...seq: string[]
): Promise<void> {
  await tick();
  for (const s of seq) {
    stdin.write(s);
    await tick();
  }
}

describe("EntityForm", () => {
  it("prompts fields in order, one visible at a time", async () => {
    const { stdin, lastFrame } = mount([
      { key: "description", label: "Description" },
      { key: "location", label: "Location" },
    ]);
    await tick();
    expect(lastFrame()).toContain("Description");
    expect(lastFrame()).not.toContain("Location");

    await keys(stdin, "a cistern", ENTER);
    expect(lastFrame()).toContain("Location");
    expect(lastFrame()).not.toContain("Description");
  });

  it("typing a value and pressing Enter records it and advances", async () => {
    const { stdin, onDone } = mount([
      { key: "description", label: "Description" },
      { key: "location", label: "Location" },
    ]);
    await keys(stdin, "a cistern", ENTER, "cavern", ENTER);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({
      description: "a cistern",
      location: "cavern",
    });
  });

  it("pressing Enter on an empty field with no default records undefined (skip)", async () => {
    const { stdin, onDone } = mount([{ key: "description", label: "Description" }]);
    await keys(stdin, ENTER);
    expect(onDone).toHaveBeenCalledWith({ description: undefined });
  });

  it("pressing Enter on a field with a defaultValue and no typed input records the default value", async () => {
    const { stdin, onDone } = mount([
      { key: "id", label: "Id", defaultValue: "cavern" },
    ]);
    await keys(stdin, ENTER);
    expect(onDone).toHaveBeenCalledWith({ id: "cavern" });
  });

  it("calls onDone exactly once with the full answers map after the last field", async () => {
    const { stdin, onDone } = mount([
      { key: "a", label: "A" },
      { key: "b", label: "B", defaultValue: "default-b" },
      { key: "c", label: "C" },
    ]);
    await keys(stdin, "val-a", ENTER, ENTER, "val-c", ENTER);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({
      a: "val-a",
      b: "default-b",
      c: "val-c",
    });
  });

  it("calls onDone({}) immediately for an empty fields array, without rendering prompts", async () => {
    const { onDone, lastFrame } = mount([]);
    await tick();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({});
    expect(lastFrame()).toBeFalsy();
  });
});
