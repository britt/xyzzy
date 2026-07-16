import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { PromptInput } from "./PromptInput.js";

// Control bytes as a terminal sends them.
const CTRL_A = "\x01";
const CTRL_E = "\x05";
const CTRL_K = "\x0b";
const CTRL_U = "\x15";
const CTRL_W = "\x17";
const BACKSPACE = "\x7f";
const ENTER = "\r";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

const tick = () => new Promise((r) => setTimeout(r, 20));

function mount(history: string[] = []) {
  const onSubmit = vi.fn();
  const r = render(<PromptInput history={history} onSubmit={onSubmit} />);
  return { ...r, onSubmit };
}

/** Send keystrokes, letting the editor process each and re-render between. */
async function keys(
  stdin: { write: (s: string) => void },
  ...seq: string[]
): Promise<void> {
  await tick(); // let useInput subscribe before the first keystroke
  for (const s of seq) {
    stdin.write(s);
    await tick();
  }
}

describe("PromptInput editing", () => {
  it("submits typed text on Enter", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "look north", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("look north");
  });

  it("Ctrl-W deletes the previous word", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "hello world", CTRL_W, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("hello ");
  });

  it("Ctrl-U deletes from the cursor to the start of the line", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "abc", CTRL_U, "def", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("def");
  });

  it("Ctrl-A moves to line start so inserts land at the beginning", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "world", CTRL_A, "hello ", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("hello world");
  });

  it("Ctrl-E moves back to line end", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "world", CTRL_A, CTRL_E, "!", ENTER);
    expect(onSubmit).toHaveBeenCalledWith("world!");
  });

  it("Ctrl-K deletes from the cursor to the end of the line", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "hello", CTRL_A, CTRL_K, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("Backspace deletes the character before the cursor", async () => {
    const { stdin, onSubmit } = mount();
    await keys(stdin, "abc", BACKSPACE, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("ab");
  });
});

describe("PromptInput history", () => {
  it("Up recalls the most recent, then older entries", async () => {
    const { stdin, onSubmit } = mount(["foo", "bar"]);
    await keys(stdin, UP, UP, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("foo");
  });

  it("Down walks forward through history", async () => {
    const { stdin, onSubmit } = mount(["foo", "bar"]);
    await keys(stdin, UP, UP, DOWN, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("bar");
  });

  it("Down past the newest entry restores the in-progress draft", async () => {
    const { stdin, onSubmit } = mount(["foo", "bar"]);
    await keys(stdin, "dra", UP, DOWN, ENTER);
    expect(onSubmit).toHaveBeenCalledWith("dra");
  });
});
