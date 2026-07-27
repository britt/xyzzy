import { describe, expect, it } from "vitest";
import { openInEditor, parseEditorCommand, resolveEditorSpec } from "./editor.js";

describe("parseEditorCommand", () => {
  it("splits a bare command", () => {
    expect(parseEditorCommand("vi")).toEqual({ command: "vi", args: [] });
  });

  it("splits a command with arguments, so EDITOR='code --wait' works", () => {
    expect(parseEditorCommand("code --wait")).toEqual({
      command: "code",
      args: ["--wait"],
    });
  });

  it("collapses surrounding and repeated whitespace", () => {
    expect(parseEditorCommand("  vim   -f  ")).toEqual({
      command: "vim",
      args: ["-f"],
    });
  });

  it("honours quoting so a path with spaces stays one token", () => {
    expect(parseEditorCommand('"/Applications/My Editor/bin/ed" -w')).toEqual({
      command: "/Applications/My Editor/bin/ed",
      args: ["-w"],
    });
    expect(parseEditorCommand("'my ed' -w")).toEqual({
      command: "my ed",
      args: ["-w"],
    });
  });
});

describe("resolveEditorSpec", () => {
  it("prefers VISUAL over EDITOR, per POSIX convention", () => {
    expect(resolveEditorSpec({ VISUAL: "vim", EDITOR: "ed" })).toBe("vim");
  });

  it("falls back to EDITOR when VISUAL is unset", () => {
    expect(resolveEditorSpec({ EDITOR: "ed" })).toBe("ed");
  });

  it("treats an empty value as unset rather than as a command", () => {
    expect(resolveEditorSpec({ VISUAL: "", EDITOR: "ed" })).toBe("ed");
    expect(resolveEditorSpec({ VISUAL: "", EDITOR: "" })).toBe("vi");
  });

  it("defaults to vi when neither is set", () => {
    expect(resolveEditorSpec({})).toBe("vi");
  });
});

describe("openInEditor", () => {
  it("passes the file as the final argument, after any editor flags", () => {
    const calls: { command: string; args: string[] }[] = [];
    openInEditor("/tmp/a/rooms/cave.yaml", {
      env: { EDITOR: "code --wait" },
      spawn: (command, args) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    });
    expect(calls).toEqual([
      { command: "code", args: ["--wait", "/tmp/a/rooms/cave.yaml"] },
    ]);
  });

  it("throws a clear, actionable error when the editor cannot be spawned", () => {
    expect(() =>
      openInEditor("/tmp/a.yaml", {
        env: { EDITOR: "definitely-not-an-editor" },
        spawn: () => ({ error: new Error("spawn ENOENT") }),
      }),
    ).toThrow(/definitely-not-an-editor/);
  });

  it("does not treat a non-zero editor exit as an error (e.g. aborting vim)", () => {
    expect(() =>
      openInEditor("/tmp/a.yaml", {
        env: { EDITOR: "vim" },
        spawn: () => ({ status: 1 }),
      }),
    ).not.toThrow();
  });
});
