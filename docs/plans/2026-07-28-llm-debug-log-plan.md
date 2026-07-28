# LLM Debugging View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist every detector/narrator LLM call made during a play session to a per-session JSONL log file, and add an "LLM Logs" category to the `xyzzy dev` sidebar to browse and inspect them.

**Architecture:** A `SessionRecorder` wraps a `NarratorModel`/`Detector` to buffer each call's context/result/timing; a `SessionLogHandle` (from `startSessionLog`) flushes one buffered turn to a `$XDG_STATE_HOME/xyzzy/<adventure-id>/logs/<session>.jsonl` file after each turn. `App.tsx` takes an optional `sessionLog` prop so the mechanism is opt-in — always supplied by `DevApp`, supplied by `play.ts` only behind a new `--log-llm` flag. `DevApp` gets a new "logs" sidebar category, read-only, rendered through the same `FieldRow`/`DisplayLine` pipeline every other category already uses.

**Tech Stack:** TypeScript (ESM), Ink, Vitest, `ink-testing-library`. See `docs/plans/2026-07-28-llm-debug-log-design.md` for the design rationale this plan implements.

**Reference reading before starting:** `src/engine/turnLoop.ts` (`runTurn`, `TurnDeps`), `src/llm/NarratorModel.ts`, `src/llm/Detector.ts`, `src/util/log.ts` (`describeError`, the XDG-log-dir pattern), `src/engine/save.ts` (`savesDir` — the exact XDG-state-dir + slugify pattern this plan mirrors), `src/tui/App.tsx`, `src/tui/DevApp.tsx`, `src/tui/dev/entityCatalog.ts`, `src/tui/dev/renderFields.ts`, `src/tui/dev/contentLines.ts`, `src/tui/dev/hotkeys.ts`.

---

## Task 1: `sessionLog.ts` — types + path resolution

**Files:**
- Create: `src/llm/sessionLog.ts`
- Test: `src/llm/sessionLog.test.ts`

Define the record shapes and pure path-resolution helpers (no fs writes yet — that's Task 3).

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { sessionLogPath } from "./sessionLog.js";

describe("sessionLogPath", () => {
  const savedState = process.env.XDG_STATE_HOME;
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  it("nests under $XDG_STATE_HOME/xyzzy/<slug>/logs/<session>.jsonl", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg";
    expect(sessionLogPath("cave-of-echoes", "2026-07-28T14-32-07")).toBe(
      "/tmp/xdg/xyzzy/cave-of-echoes/logs/2026-07-28T14-32-07.jsonl",
    );
  });

  it("slugifies an adventure id with punctuation, mirroring savesDir", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg";
    expect(sessionLogPath("My Adventure!", "s1")).toBe(
      "/tmp/xdg/xyzzy/my-adventure/logs/s1.jsonl",
    );
  });

  it("falls back to a hex encoding for an id that slugifies to empty", () => {
    process.env.XDG_STATE_HOME = "/tmp/xdg";
    const hex = Buffer.from("...", "utf8").toString("hex");
    expect(sessionLogPath("...", "s1")).toBe(`/tmp/xdg/xyzzy/${hex}/logs/s1.jsonl`);
  });
});
```

(Add `import { afterEach } from "vitest"` to the real import line above.)

**Step 2: Run test to verify it fails**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: FAIL — `sessionLog.ts` does not exist / `sessionLogPath` is not exported.

**Step 3: Write minimal implementation**

```ts
// src/llm/sessionLog.ts
import { homedir } from "node:os";
import { join } from "node:path";
import { slugify } from "../util/slug.js";

export type SessionSource = "dev" | "play";

export interface SessionHeader {
  type: "session";
  startedAt: string;
  adventure: string;
  source: SessionSource;
  provider: { kind: string; baseURL?: string; model: string };
  saveSlot: string;
  resumedFrom: string | null;
}

export type CallLog<Ctx, Res> =
  | { context: Ctx; ms: number; ok: true; result: Res }
  | { context: Ctx; ms: number; ok: false; error: Record<string, unknown> };

export interface TurnRecord<DetectorCall = unknown, NarratorCall = unknown> {
  type: "turn";
  turn: number;
  input: string;
  detector: DetectorCall[];
  narrator: NarratorCall[];
}

/**
 * `$XDG_STATE_HOME/xyzzy/<slug>/logs` — mirrors `savesDir` in
 * `engine/save.ts` exactly (same base-dir resolution, same slugify + hex
 * fallback for an id that collapses to nothing), just under `logs` instead
 * of `saves`.
 */
function sessionLogDir(adventureId: string): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const slug = slugify(adventureId) || Buffer.from(adventureId, "utf8").toString("hex");
  return join(base, "xyzzy", slug, "logs");
}

export function sessionLogPath(adventureId: string, sessionId: string): string {
  return join(sessionLogDir(adventureId), `${sessionId}.jsonl`);
}
```

Leave `DetectorCallLog`/`NarratorCallLog` (the concrete `CallLog<...>` instantiations) for Task 2, once `Detector`/`NarratorModel` types are in scope — adding them now with no consumer would be untested dead code.

**Step 4: Run test to verify it passes**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/llm/sessionLog.ts src/llm/sessionLog.test.ts
git commit -m "feat(llm): add session log path resolution

- RED: sessionLogPath nesting, slugify, hex-fallback cases
- GREEN: sessionLogDir/sessionLogPath mirroring engine/save.ts's savesDir
- Status: tests passing, build unaffected"
```

---

## Task 2: `SessionRecorder` — wrap model/detector, buffer, flush per turn

**Files:**
- Modify: `src/llm/sessionLog.ts`
- Test: `src/llm/sessionLog.test.ts`

**Step 1: Write the failing test**

```ts
import { FakeNarratorModel } from "./NarratorModel.js";
import { FakeDetector } from "./Detector.js";
import { SessionRecorder, type TurnRecord } from "./sessionLog.js";

describe("SessionRecorder", () => {
  it("wraps a narrator model, buffering successful calls and forwarding the result", async () => {
    const recorder = new SessionRecorder();
    const model = new FakeNarratorModel([{ narration: "Hi.", actions: [] }]);
    const wrapped = recorder.wrapModel(model);

    const ctx = { systemPrompt: "sp", digest: "d", transcript: [], input: "look" };
    const result = await wrapped.generate(ctx);
    expect(result).toEqual({ narration: "Hi.", actions: [] });

    const turn = recorder.flushTurn(1, "look");
    expect(turn.narrator).toEqual([
      { context: ctx, ms: expect.any(Number), ok: true, result: { narration: "Hi.", actions: [] } },
    ]);
    expect(turn.detector).toEqual([]);
    expect(turn.type).toBe("turn");
    expect(turn.turn).toBe(1);
    expect(turn.input).toBe("look");
  });

  it("records a failed narrator call and rethrows", async () => {
    const recorder = new SessionRecorder();
    const failing = { generate: () => Promise.reject(new Error("boom")) };
    const wrapped = recorder.wrapModel(failing);
    const ctx = { systemPrompt: "sp", digest: "d", transcript: [], input: "look" };

    await expect(wrapped.generate(ctx)).rejects.toThrow("boom");

    const turn = recorder.flushTurn(1, "look");
    expect(turn.narrator).toEqual([
      { context: ctx, ms: expect.any(Number), ok: false, error: expect.objectContaining({ message: "boom" }) },
    ]);
  });

  it("wraps a detector the same way", async () => {
    const recorder = new SessionRecorder();
    const detector = new FakeDetector([
      { move: null, advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const wrapped = recorder.wrapDetector(detector);
    const ctx = { input: "go north", exits: [], activeBeats: [], characterBeats: [], interactions: [] };
    await wrapped.detect(ctx);

    const turn = recorder.flushTurn(1, "go north");
    expect(turn.detector).toHaveLength(1);
    expect(turn.detector[0]).toMatchObject({ ok: true, context: ctx });
  });

  it("clears buffers after flushTurn, so the next turn starts empty", async () => {
    const recorder = new SessionRecorder();
    const model = new FakeNarratorModel([{ narration: "Hi.", actions: [] }]);
    const wrapped = recorder.wrapModel(model);
    const ctx = { systemPrompt: "sp", digest: "d", transcript: [], input: "look" };
    await wrapped.generate(ctx);
    recorder.flushTurn(1, "look");

    const second = recorder.flushTurn(2, "look again");
    expect(second.narrator).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: FAIL — `SessionRecorder` is not exported.

**Step 3: Write minimal implementation**

Add to `src/llm/sessionLog.ts`:

```ts
import type { Detector, DetectionContext, Detection } from "./Detector.js";
import type { NarratorModel, NarratorContext, NarratorResult } from "./NarratorModel.js";
import { describeError } from "../util/log.js";

export type DetectorCallLog = CallLog<DetectionContext, Detection>;
export type NarratorCallLog = CallLog<NarratorContext, NarratorResult>;

export class SessionRecorder {
  private pendingDetector: DetectorCallLog[] = [];
  private pendingNarrator: NarratorCallLog[] = [];

  wrapDetector(detector: Detector): Detector {
    return {
      detect: async (ctx) => {
        const start = Date.now();
        try {
          const result = await detector.detect(ctx);
          this.pendingDetector.push({ context: ctx, ms: Date.now() - start, ok: true, result });
          return result;
        } catch (err) {
          this.pendingDetector.push({
            context: ctx,
            ms: Date.now() - start,
            ok: false,
            error: describeError(err),
          });
          throw err;
        }
      },
    };
  }

  wrapModel(model: NarratorModel): NarratorModel {
    return {
      generate: async (ctx) => {
        const start = Date.now();
        try {
          const result = await model.generate(ctx);
          this.pendingNarrator.push({ context: ctx, ms: Date.now() - start, ok: true, result });
          return result;
        } catch (err) {
          this.pendingNarrator.push({
            context: ctx,
            ms: Date.now() - start,
            ok: false,
            error: describeError(err),
          });
          throw err;
        }
      },
    };
  }

  flushTurn(turn: number, input: string): TurnRecord<DetectorCallLog, NarratorCallLog> {
    const record: TurnRecord<DetectorCallLog, NarratorCallLog> = {
      type: "turn",
      turn,
      input,
      detector: this.pendingDetector,
      narrator: this.pendingNarrator,
    };
    this.pendingDetector = [];
    this.pendingNarrator = [];
    return record;
  }
}

export type SessionLogRecord = SessionHeader | TurnRecord<DetectorCallLog, NarratorCallLog>;
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: PASS (7 tests total)

**Step 5: Commit**

```bash
git add src/llm/sessionLog.ts src/llm/sessionLog.test.ts
git commit -m "feat(llm): add SessionRecorder to buffer detector/narrator calls per turn

- RED: wrap success/failure for model and detector, flush clears buffers
- GREEN: SessionRecorder.wrapModel/wrapDetector/flushTurn
- Status: tests passing"
```

---

## Task 3: `startSessionLog` — disk writer (best-effort, header + append)

**Files:**
- Modify: `src/llm/sessionLog.ts`
- Test: `src/llm/sessionLog.test.ts`

**Step 1: Write the failing test**

```ts
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionLog } from "./sessionLog.js";

describe("startSessionLog", () => {
  const savedState = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-sessionlog-"));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  function lines(path: string): unknown[] {
    return readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  }

  it("writes a session header line immediately, before any turn", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "dev",
      provider: { kind: "openai-compatible", baseURL: "http://localhost:11434/v1", model: "llama3.1" },
      saveSlot: "autosave",
      resumedFrom: null,
      clock: () => "2026-07-28T14:32:07.000Z",
    });

    expect(existsSync(handle.path)).toBe(true);
    expect(lines(handle.path)).toEqual([
      {
        type: "session",
        startedAt: "2026-07-28T14:32:07.000Z",
        adventure: "cave",
        source: "dev",
        provider: { kind: "openai-compatible", baseURL: "http://localhost:11434/v1", model: "llama3.1" },
        saveSlot: "autosave",
        resumedFrom: null,
      },
    ]);
  });

  it("appendTurn appends one JSON line per call", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "play",
      provider: { kind: "openai-compatible", model: "llama3.1" },
      saveSlot: "autosave",
      resumedFrom: "before-boss",
      clock: () => "2026-07-28T14:32:07.000Z",
    });
    handle.appendTurn(handle.recorder.flushTurn(1, "look"));
    handle.appendTurn(handle.recorder.flushTurn(2, "go north"));

    const all = lines(handle.path);
    expect(all).toHaveLength(3); // header + 2 turns
    expect(all[1]).toMatchObject({ type: "turn", turn: 1, input: "look" });
    expect(all[2]).toMatchObject({ type: "turn", turn: 2, input: "go north" });
  });

  it("sanitizes the clock timestamp into a filesystem-safe session id", () => {
    const handle = startSessionLog({
      adventureId: "cave",
      source: "dev",
      provider: { kind: "openai-compatible", model: "llama3.1" },
      saveSlot: "autosave",
      resumedFrom: null,
      clock: () => "2026-07-28T14:32:07.123Z",
    });
    expect(handle.path.endsWith("2026-07-28T14-32-07-123Z.jsonl")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: FAIL — `startSessionLog` is not exported.

**Step 3: Write minimal implementation**

Add to `src/llm/sessionLog.ts`:

```ts
import { appendFileSync, mkdirSync } from "node:fs";

export interface SessionLogHandle {
  path: string;
  recorder: SessionRecorder;
  appendTurn(record: TurnRecord<DetectorCallLog, NarratorCallLog>): void;
}

export interface StartSessionLogOptions {
  adventureId: string;
  source: SessionSource;
  provider: { kind: string; baseURL?: string; model: string };
  saveSlot: string;
  resumedFrom: string | null;
  /** injectable for deterministic tests; defaults to the real clock. */
  clock?: () => string;
}

function sanitizeForFilename(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/** Append one record as a JSON line. Best-effort: a disk failure here must
 * never break gameplay, matching util/log.ts's `emit`. */
function appendRecord(dir: string, path: string, record: SessionLogRecord): void {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch {
    // best-effort
  }
}

export function startSessionLog(opts: StartSessionLogOptions): SessionLogHandle {
  const recorder = new SessionRecorder();
  const startedAt = (opts.clock ?? (() => new Date().toISOString()))();
  const sessionId = sanitizeForFilename(startedAt);
  const dir = sessionLogDir(opts.adventureId);
  const path = sessionLogPath(opts.adventureId, sessionId);

  const header: SessionHeader = {
    type: "session",
    startedAt,
    adventure: opts.adventureId,
    source: opts.source,
    provider: opts.provider,
    saveSlot: opts.saveSlot,
    resumedFrom: opts.resumedFrom,
  };
  appendRecord(dir, path, header);

  return {
    path,
    recorder,
    appendTurn: (record) => appendRecord(dir, path, record),
  };
}
```

Note `sessionLogDir` currently isn't exported — keep it private and call it directly from within the same module (both `sessionLogPath` and `startSessionLog` live in `sessionLog.ts`).

**Step 4: Run test to verify it passes**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: PASS (10 tests total)

**Step 5: Commit**

```bash
git add src/llm/sessionLog.ts src/llm/sessionLog.test.ts
git commit -m "feat(llm): add startSessionLog disk writer

- RED: header written immediately, appendTurn appends JSONL, id sanitization
- GREEN: startSessionLog + best-effort appendRecord (mirrors util/log.ts)
- Status: tests passing"
```

---

## Task 4: `listSessionLogs` — directory listing for the sidebar

**Files:**
- Modify: `src/llm/sessionLog.ts`
- Test: `src/llm/sessionLog.test.ts`

**Step 1: Write the failing test**

```ts
import { listSessionLogs } from "./sessionLog.js";

describe("listSessionLogs", () => {
  const savedState = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-sessionlog-list-"));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  it("returns [] when no logs directory exists yet", () => {
    expect(listSessionLogs("cave")).toEqual([]);
  });

  it("lists sessions newest-first, with metadata read from each header line", () => {
    startSessionLog({
      adventureId: "cave", source: "dev",
      provider: { kind: "openai-compatible", model: "a" }, saveSlot: "autosave", resumedFrom: null,
      clock: () => "2026-07-28T10-00-00.000Z",
    });
    startSessionLog({
      adventureId: "cave", source: "play",
      provider: { kind: "openai-compatible", model: "a" }, saveSlot: "autosave", resumedFrom: null,
      clock: () => "2026-07-28T12-00-00.000Z",
    });

    const listing = listSessionLogs("cave");
    expect(listing).toHaveLength(2);
    expect(listing[0]!.source).toBe("play"); // newer session first
    expect(listing[1]!.source).toBe("dev");
    expect(listing[0]!.startedAt).toBe("2026-07-28T12-00-00.000Z");
  });

  it("tolerates a corrupt header line by falling back to the filename", () => {
    const dir = sessionLogPathDirFor("cave"); // see helper note below
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.jsonl"), "not json\n");

    const listing = listSessionLogs("cave");
    expect(listing).toEqual([{ path: join(dir, "broken.jsonl"), file: "broken.jsonl", startedAt: "broken", source: "unknown" }]);
  });
});
```

`sessionLogPathDirFor` isn't a real export — in the actual test file, build that path with `dirname(sessionLogPath("cave", "x"))` instead (no new export needed):

```ts
import { dirname } from "node:path";
// ...
const dir = dirname(sessionLogPath("cave", "x"));
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: FAIL — `listSessionLogs` is not exported.

**Step 3: Write minimal implementation**

Add to `src/llm/sessionLog.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";

export interface SessionLogListing {
  path: string;
  file: string;
  startedAt: string;
  source: SessionSource | "unknown";
}

export function listSessionLogs(adventureId: string): SessionLogListing[] {
  const dir = sessionLogDir(adventureId);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .reverse()
    .map((file) => {
      const path = join(dir, file);
      const fallback = file.replace(/\.jsonl$/, "");
      try {
        const firstLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
        const header = JSON.parse(firstLine) as SessionHeader;
        return { path, file, startedAt: header.startedAt, source: header.source };
      } catch {
        return { path, file, startedAt: fallback, source: "unknown" as const };
      }
    });
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: PASS (13 tests total)

**Step 5: Commit**

```bash
git add src/llm/sessionLog.ts src/llm/sessionLog.test.ts
git commit -m "feat(llm): add listSessionLogs directory listing

- RED: empty when no logs dir, newest-first ordering, corrupt-header fallback
- GREEN: listSessionLogs reading + tolerating a bad header line
- Status: tests passing"
```

---

## Task 5: `readSessionLog` — full parse for the content pane

**Files:**
- Modify: `src/llm/sessionLog.ts`
- Test: `src/llm/sessionLog.test.ts`

Unlike `listSessionLogs` (tolerant, for a cheap sidebar label), this is the
"open and view" path — a missing or corrupt file must throw a clear error so
`DevApp` can show the same inline error-banner treatment `editSelected()`
already uses for bad YAML.

**Step 1: Write the failing test**

```ts
import { readSessionLog } from "./sessionLog.js";

describe("readSessionLog", () => {
  it("parses every line of a well-formed session log", () => {
    const handle = startSessionLog({
      adventureId: "cave", source: "dev",
      provider: { kind: "openai-compatible", model: "a" }, saveSlot: "autosave", resumedFrom: null,
      clock: () => "2026-07-28T14-32-07.000Z",
    });
    handle.appendTurn(handle.recorder.flushTurn(1, "look"));

    const records = readSessionLog(handle.path);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ type: "session" });
    expect(records[1]).toMatchObject({ type: "turn", turn: 1 });
  });

  it("throws a clear error for a missing file", () => {
    expect(() => readSessionLog("/tmp/does-not-exist.jsonl")).toThrow(/No such session log/);
  });

  it("throws a clear error naming the bad line for corrupt JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "xyzzy-sessionlog-read-"));
    const path = join(dir, "bad.jsonl");
    writeFileSync(path, '{"type":"session"}\nnot json\n');
    expect(() => readSessionLog(path)).toThrow(/line 2/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: FAIL — `readSessionLog` is not exported.

**Step 3: Write minimal implementation**

Add to `src/llm/sessionLog.ts`:

```ts
export function readSessionLog(path: string): SessionLogRecord[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`No such session log: ${path}`);
  }

  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      try {
        return JSON.parse(line) as SessionLogRecord;
      } catch {
        throw new Error(`Session log is corrupt at line ${i + 1}: ${path}`);
      }
    });
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/llm/sessionLog.test.ts`
Expected: PASS (16 tests total)

**Step 5: Commit**

```bash
git add src/llm/sessionLog.ts src/llm/sessionLog.test.ts
git commit -m "feat(llm): add readSessionLog full-file parser

- RED: parses well-formed log, throws on missing file, throws naming bad line
- GREEN: readSessionLog
- Status: tests passing"
```

---

## Task 6: `renderSessionLog.ts` — pure `FieldRow` formatter

**Files:**
- Create: `src/tui/dev/renderSessionLog.ts`
- Test: `src/tui/dev/renderSessionLog.test.ts`

Turns parsed `SessionLogRecord[]` into `FieldRow[]`, reusing the exact same
row shapes `renderFields.ts` already defines (`heading`/`scalar`/`block`/
`list`) so `DevApp`'s existing `layoutFieldRows` → `ContentLine` pipeline
renders it with zero new UI code.

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderSessionLogFields } from "./renderSessionLog.js";
import type { SessionLogRecord } from "../../llm/sessionLog.js";

const header: SessionLogRecord = {
  type: "session",
  startedAt: "2026-07-28T14:32:07.000Z",
  adventure: "cave",
  source: "dev",
  provider: { kind: "openai-compatible", baseURL: "http://localhost:11434/v1", model: "llama3.1" },
  saveSlot: "autosave",
  resumedFrom: null,
};

describe("renderSessionLogFields", () => {
  it("renders the session header as a heading + scalar rows", () => {
    const rows = renderSessionLogFields([header]);
    expect(rows[0]).toMatchObject({ kind: "heading", title: "2026-07-28T14:32:07.000Z" });
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "scalar", label: "Source", value: "dev" }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: "scalar", label: "Save slot", value: "autosave" }),
    );
  });

  it("renders a successful narrator call with its context and narration", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 1,
      input: "look",
      detector: [],
      narrator: [
        {
          context: { systemPrompt: "sp", digest: "d", transcript: [], input: "look" },
          ms: 12,
          ok: true,
          result: { narration: "You look around.", actions: [{ type: "addItem", item: "key" }] },
        },
      ],
    };
    const rows = renderSessionLogFields([header, turn]);
    const text = JSON.stringify(rows);
    expect(text).toContain("You look around.");
    expect(text).toContain("look"); // player input surfaced
    expect(text).toContain("addItem");
  });

  it("renders a failed narrator call's error instead of a result", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 2,
      input: "go north",
      detector: [],
      narrator: [
        {
          context: { systemPrompt: "sp", digest: "d", transcript: [], input: "go north" },
          ms: 5,
          ok: false,
          error: { name: "Error", message: "boom" },
        },
      ],
    };
    const rows = renderSessionLogFields([header, turn]);
    expect(JSON.stringify(rows)).toContain("boom");
  });

  it("renders a detector call alongside the narrator call for the same turn", () => {
    const turn: SessionLogRecord = {
      type: "turn",
      turn: 1,
      input: "go north",
      detector: [
        {
          context: { input: "go north", exits: [], activeBeats: [], characterBeats: [], interactions: [] },
          ms: 3,
          ok: true,
          result: { move: "north", advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
        },
      ],
      narrator: [],
    };
    const rows = renderSessionLogFields([header, turn]);
    expect(JSON.stringify(rows)).toContain("Detector");
  });

  it("returns [] for an empty record list", () => {
    expect(renderSessionLogFields([])).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/tui/dev/renderSessionLog.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Write minimal implementation**

```ts
// src/tui/dev/renderSessionLog.ts
import type { FieldRow } from "./renderFields.js";
import type {
  SessionLogRecord,
  SessionHeader,
  TurnRecord,
  DetectorCallLog,
  NarratorCallLog,
} from "../../llm/sessionLog.js";

function renderHeader(header: SessionHeader): FieldRow[] {
  return [
    { kind: "heading", title: header.startedAt, subtitle: header.adventure },
    { kind: "scalar", label: "Source", value: header.source, dim: false },
    {
      kind: "scalar",
      label: "Provider",
      value: `${header.provider.kind} · ${header.provider.model}`,
      dim: false,
    },
    { kind: "scalar", label: "Save slot", value: header.saveSlot, dim: false },
    {
      kind: "scalar",
      label: "Resumed from",
      value: header.resumedFrom ?? "(new game)",
      dim: header.resumedFrom === null,
    },
  ];
}

function renderNarratorCall(call: NarratorCallLog, index: number): FieldRow[] {
  const label = `Narrator call ${index + 1} (${call.ms}ms, ${call.ok ? "ok" : "failed"})`;
  const base: FieldRow[] = [
    { kind: "scalar", label, value: "", dim: false },
    { kind: "block", label: "System prompt", value: call.context.systemPrompt, dim: false },
    { kind: "block", label: "Digest", value: call.context.digest, dim: false },
  ];
  if (call.ok) {
    return [
      ...base,
      { kind: "block", label: "Narration", value: call.result.narration, dim: false },
      {
        kind: "list",
        label: "Actions",
        items: call.result.actions.map((a) => JSON.stringify(a)),
      },
    ];
  }
  return [...base, { kind: "block", label: "Error", value: JSON.stringify(call.error), dim: false }];
}

function renderDetectorCall(call: DetectorCallLog, index: number): FieldRow[] {
  const label = `Detector call ${index + 1} (${call.ms}ms, ${call.ok ? "ok" : "failed"})`;
  const base: FieldRow[] = [{ kind: "scalar", label, value: "", dim: false }];
  return call.ok
    ? [...base, { kind: "block", label: "Detection", value: JSON.stringify(call.result), dim: false }]
    : [...base, { kind: "block", label: "Error", value: JSON.stringify(call.error), dim: false }];
}

function renderTurn(turn: TurnRecord<DetectorCallLog, NarratorCallLog>): FieldRow[] {
  const rows: FieldRow[] = [
    { kind: "heading", title: `Turn ${turn.turn}` },
    { kind: "block", label: "Input", value: turn.input, dim: false },
  ];
  turn.detector.forEach((call, i) => rows.push(...renderDetectorCall(call, i)));
  turn.narrator.forEach((call, i) => rows.push(...renderNarratorCall(call, i)));
  return rows;
}

export function renderSessionLogFields(records: SessionLogRecord[]): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const record of records) {
    rows.push(...(record.type === "session" ? renderHeader(record) : renderTurn(record)));
  }
  return rows;
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/tui/dev/renderSessionLog.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/tui/dev/renderSessionLog.ts src/tui/dev/renderSessionLog.test.ts
git commit -m "feat(tui): add renderSessionLogFields formatter

- RED: header row, successful/failed narrator call, detector call, empty list
- GREEN: renderSessionLogFields reusing the existing FieldRow shapes
- Status: tests passing"
```

---

## Task 7: `entityCatalog.ts` — add the `"logs"` category

**Files:**
- Modify: `src/tui/dev/entityCatalog.ts`
- Test: `src/tui/dev/entityCatalog.test.ts`

The `"logs"` category is a full sidebar tab, but (like `"config"`) has no
`CatalogEntry` list of its own — `DevApp` will source its list separately
from `listSessionLogs`. This task only adds the category to the type and
fixed order, and confirms `entriesForCategory` returns `[]` for it, the same
as `"config"`.

**Step 1: Write the failing test**

Add to `src/tui/dev/entityCatalog.test.ts`:

```ts
it("includes logs as the last category, after items", () => {
  expect(CATEGORIES[CATEGORIES.length - 1]).toBe("logs");
});

it("returns no entries for the logs category (DevApp sources these separately)", () => {
  expect(entriesForCategory(adventure, "logs")).toEqual([]);
});

it("labels the logs category 'LLM Logs'", () => {
  expect(CATEGORY_LABELS.logs).toBe("LLM Logs");
});
```

(Use whatever local `adventure` fixture the existing test file already
defines.)

**Step 2: Run test to verify it fails**

Run: `bun run test src/tui/dev/entityCatalog.test.ts`
Expected: FAIL — `"logs"` isn't a valid `Category`, `CATEGORY_LABELS.logs` is undefined.

**Step 3: Write minimal implementation**

In `src/tui/dev/entityCatalog.ts`:

```ts
export type Category = "config" | "beats" | "characters" | "rooms" | "items" | "logs";

export const CATEGORIES: readonly Category[] = [
  "config",
  "beats",
  "characters",
  "rooms",
  "items",
  "logs",
];

export const CATEGORY_LABELS: Record<Category, string> = {
  config: "Adventure Config",
  beats: "Beats",
  characters: "Characters",
  rooms: "Rooms",
  items: "Items",
  logs: "LLM Logs",
};
```

And in `entriesForCategory`'s `switch`:

```ts
case "logs":
  return [];
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/tui/dev/entityCatalog.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tui/dev/entityCatalog.ts src/tui/dev/entityCatalog.test.ts
git commit -m "feat(tui): add logs category to the dev sidebar's fixed order

- RED: logs is last category, entriesForCategory returns [], label is 'LLM Logs'
- GREEN: extend Category union + CATEGORIES + CATEGORY_LABELS + switch case
- Status: tests passing"
```

---

## Task 8: `hotkeys.ts` — suppress Edit for the logs category

**Files:**
- Modify: `src/tui/dev/hotkeys.ts`
- Test: `src/tui/dev/hotkeys.test.ts`

Logs are read-only (per the design's Q1 answer), so `e` must never appear in
the footer while browsing them, regardless of how many log entries exist.

**Step 1: Write the failing test**

Add to `src/tui/dev/hotkeys.test.ts`:

```ts
it("omits the Edit key for the logs category, even with entries selected", () => {
  const keys = hotKeysFor({
    focus: "sidebar",
    submenuOpen: false,
    entryCount: 3,
    isConfigCategory: false,
    isLogsCategory: true,
    hasLiveSession: false,
    canPlay: false,
  });
  expect(keys.some((k) => k.key === "e")).toBe(false);
});

it("still offers Entity navigation for the logs category", () => {
  const keys = hotKeysFor({
    focus: "sidebar",
    submenuOpen: false,
    entryCount: 3,
    isConfigCategory: false,
    isLogsCategory: true,
    hasLiveSession: false,
    canPlay: false,
  });
  expect(keys.some((k) => k.key === "↑↓")).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/tui/dev/hotkeys.test.ts`
Expected: FAIL — `isLogsCategory` doesn't exist on `HotKeyContext`, so this is a type error / the `e` key still appears (edit condition doesn't yet exclude logs).

**Step 3: Write minimal implementation**

In `src/tui/dev/hotkeys.ts`:

```ts
export interface HotKeyContext {
  focus: "sidebar" | "play";
  submenuOpen: boolean;
  entryCount: number;
  isConfigCategory: boolean;
  /** Logs are read-only — Edit is never offered regardless of entryCount. */
  isLogsCategory: boolean;
  hasLiveSession: boolean;
  canPlay: boolean;
  canScrollContent?: boolean;
}
```

And change the edit-key condition:

```ts
if (!isLogsCategory && (isConfigCategory || entryCount > 0)) {
  keys.push({ key: "e", label: "Edit" });
}
```

(Destructure `isLogsCategory` alongside the other context fields at the top of `hotKeysFor`.)

**Step 4: Run test to verify it passes**

Run: `bun run test src/tui/dev/hotkeys.test.ts`
Expected: PASS

Note: this is a breaking change to `HotKeyContext` (new required field) —
`DevApp.tsx`'s existing call site won't compile until Task 10 updates it.
That's fine; Task 10 happens before the final full-suite pass in Task 13.

**Step 5: Commit**

```bash
git add src/tui/dev/hotkeys.ts src/tui/dev/hotkeys.test.ts
git commit -m "feat(tui): suppress the Edit hotkey for the read-only logs category

- RED: e omitted for logs regardless of entryCount; ↑↓ still offered
- GREEN: isLogsCategory on HotKeyContext gates the edit-key push
- Status: tests passing (DevApp call site updated in a later task)"
```

---

## Task 9: `App.tsx` — optional `sessionLog` prop

**Files:**
- Modify: `src/tui/App.tsx`
- Test: `src/tui/App.test.tsx`

**Step 1: Write the failing test**

Add to `src/tui/App.test.tsx` (in a new `describe` block; extend the local
`mount()` helper's `extra` parameter type to accept `sessionLog?:
SessionLogHandle` and spread it into `<App>`'s props):

```ts
import { listSessionLogs, readSessionLog, startSessionLog, type SessionLogHandle } from "../llm/sessionLog.js";

describe("session logging", () => {
  const savedState = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-app-sessionlog-"));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  it("does not touch disk when no sessionLog is supplied", async () => {
    const model = new FakeNarratorModel([{ narration: "Hi.", actions: [] }]);
    const { stdin, unmount } = mount(model);
    await type(stdin, "look");
    await tick();
    expect(listSessionLogs(adventure.meta.id)).toEqual([]);
    unmount();
  });

  it("appends a turn record after a successful turn when sessionLog is supplied", async () => {
    const handle = startSessionLog({
      adventureId: adventure.meta.id,
      source: "dev",
      provider: { kind: "openai-compatible", model: "a" },
      saveSlot: "autosave",
      resumedFrom: null,
    });
    const model = new FakeNarratorModel([{ narration: "You look around.", actions: [] }]);
    const { stdin, unmount } = mount(model, undefined, undefined, undefined, undefined, { sessionLog: handle });

    await type(stdin, "look");
    await expect.poll(() => readSessionLog(handle.path).length).toBe(2); // header + 1 turn

    const turn = readSessionLog(handle.path)[1] as { narrator: unknown[] };
    expect(turn).toMatchObject({ type: "turn", turn: 1, input: "look" });
    expect(turn.narrator).toHaveLength(1);
    unmount();
  });

  it("appends a turn record (with the narrator error) after a failed turn", async () => {
    const handle = startSessionLog({
      adventureId: adventure.meta.id,
      source: "dev",
      provider: { kind: "openai-compatible", model: "a" },
      saveSlot: "autosave",
      resumedFrom: null,
    });
    const failing: NarratorModel = { generate: () => Promise.reject(new Error("boom")) };
    const { stdin, unmount } = mount(failing, undefined, undefined, undefined, undefined, { sessionLog: handle });

    await type(stdin, "look");
    await expect.poll(() => readSessionLog(handle.path).length).toBe(2);

    const turn = readSessionLog(handle.path)[1] as { narrator: { ok: boolean }[] };
    expect(turn.narrator[0]!.ok).toBe(false);
    unmount();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/tui/App.test.tsx`
Expected: FAIL — `AppProps` has no `sessionLog` field; no turn record is ever
appended (the "no sessionLog" test may pass already, but the other two fail).

**Step 3: Write minimal implementation**

In `src/tui/App.tsx`:

```ts
import type { SessionLogHandle } from "../llm/sessionLog.js";

export interface AppProps {
  // ...existing fields...
  /**
   * When supplied, every detector/narrator call this session makes is
   * recorded and appended as one JSONL turn record after each turn (success
   * or failure). Omitted for standalone `xyzzy play` unless `--log-llm` is
   * passed; always supplied by `DevApp`.
   */
  sessionLog?: SessionLogHandle;
}
```

Add two small helpers near `buildModel`/`buildDetector`:

```ts
function withSessionLog(
  model: NarratorModel | null,
  sessionLog: SessionLogHandle | undefined,
): NarratorModel | null {
  return model && sessionLog ? sessionLog.recorder.wrapModel(model) : model;
}

function withDetectorSessionLog(
  detector: Detector | undefined,
  sessionLog: SessionLogHandle | undefined,
): Detector | undefined {
  return detector && sessionLog ? sessionLog.recorder.wrapDetector(detector) : detector;
}
```

Destructure `sessionLog` in `App`'s props, then wrap at both model-build
sites:

```ts
const [{ model, modelError }, setModelState] = useState(() => {
  const built = buildModel(makeModel, initialProvider);
  return { model: withSessionLog(built.model, sessionLog), modelError: built.error };
});
const [detector, setDetector] = useState(() =>
  withDetectorSessionLog(buildDetector(makeDetector, initialProvider), sessionLog),
);
```

```ts
function applyProvider(next: ProviderConfig, okMsg: string) {
  const built = buildModel(makeModel, next);
  setProvider(next);
  setModelState({ model: withSessionLog(built.model, sessionLog), modelError: built.error });
  setDetector(withDetectorSessionLog(buildDetector(makeDetector, next), sessionLog));
  push(/* unchanged */);
}
```

Finally, flush and append in `submit()`, right after the timing/log calls
already there, in both the success and failure branches:

```ts
try {
  const result = await runTurn({ adventure, model, detector }, state, value);
  const totalMs = Date.now() - turnStart;
  setState(result.state);
  setLastTiming({ ...result.timing, totalMs });
  log.info("turn timing", { turn: attemptedTurn, totalMs, ...result.timing, ok: true });
  if (sessionLog) sessionLog.appendTurn(sessionLog.recorder.flushTurn(attemptedTurn, value));
  push("narrator", result.narration);
  await saveGame(adventure.meta.id, saveSlot, result.state);
} catch (err) {
  log.info("turn timing", { turn: attemptedTurn, totalMs: Date.now() - turnStart, ok: false });
  log.error(`turn failed: ${value}`, err);
  if (sessionLog) sessionLog.appendTurn(sessionLog.recorder.flushTurn(attemptedTurn, value));
  setError(`${userMessage(err)} · details in ${logPath()}`);
} finally {
  setBusy(false);
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/tui/App.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "feat(tui): wire an optional sessionLog prop through App

- RED: no disk I/O when omitted; turn record appended on success and failure
- GREEN: withSessionLog/withDetectorSessionLog wrapping + flush-on-turn-end
- Status: tests passing"
```

---

## Task 10: `DevApp.tsx` — logs category, sidebar, content pane

**Files:**
- Modify: `src/tui/DevApp.tsx`
- Test: `src/tui/DevApp.test.tsx`

This is the integration task wiring Tasks 1–8 into the actual sidebar. It's
larger than the others because it's assembling already-tested pieces rather
than inventing new logic — still commit as one unit once green, per the
project's "no more than 30 minutes uncommitted" rule; split into two commits
(listing/selection, then content-pane rendering) if it runs long.

**Step 1: Write the failing tests**

Add a new `describe` block to `src/tui/DevApp.test.tsx` (reuse the
`XDG_STATE_HOME` isolation pattern from the existing `"DevApp play-focus
mode"` block, and `mountForPlay`):

```ts
import { listSessionLogs, startSessionLog } from "../llm/sessionLog.js";

describe("DevApp LLM Logs category", () => {
  const savedState = process.env.XDG_STATE_HOME;
  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-devapp-logs-"));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  async function toLogs(stdin: { write: (s: string) => void }) {
    for (let i = 0; i < 5; i++) await press(stdin, "\t"); // Config -> ... -> Logs
  }

  it("shows an empty LLM Logs category when no sessions have run", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await toLogs(stdin);
    expect(lastFrame()).toContain("LLM Logs");
    unmount();
  });

  it("lists a session log created by a prior xyzzy dev run", async () => {
    startSessionLog({
      adventureId: adventure.meta.id, source: "dev",
      provider: { kind: "openai-compatible", model: "a" }, saveSlot: "autosave", resumedFrom: null,
      clock: () => "2026-07-28T14-32-07.000Z",
    });
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await toLogs(stdin);
    expect(lastFrame()).toContain("2026-07-28T14-32-07.000Z");
    unmount();
  });

  it("starting a New Game session creates a log that appears without restarting", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r"); // New Game
    await press(stdin, ESC); // back to sidebar; session keeps running
    await toLogs(stdin);
    expect(listSessionLogs(adventure.meta.id)).toHaveLength(1);
    expect(lastFrame()).toContain("dev");
    unmount();
  });

  it("selecting a log renders its content in the pane", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await press(stdin, "p");
    await press(stdin, "\r");
    await press(stdin, ESC);
    await toLogs(stdin);
    expect(lastFrame()).toContain("autosave"); // save slot field from the header
    unmount();
  });

  it("does not offer the Edit hotkey while browsing logs", async () => {
    const dir = tmpAdventure();
    const { lastFrame, stdin, unmount } = mountForPlay(dir);
    await toLogs(stdin);
    const footer = lastFrame()!.split("\n").pop()!;
    expect(footer).not.toContain(" e ");
    unmount();
  });

  it("pressing e while browsing logs does nothing", async () => {
    const dir = tmpAdventure();
    startSessionLog({
      adventureId: adventure.meta.id, source: "dev",
      provider: { kind: "openai-compatible", model: "a" }, saveSlot: "autosave", resumedFrom: null,
    });
    const opened: string[] = [];
    const { stdin, unmount } = render(
      <DevApp adventure={adventure} adventureDir={dir} openEditor={(p) => opened.push(p)} />,
    );
    await toLogs(stdin);
    await press(stdin, "e");
    expect(opened).toEqual([]);
    unmount();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/tui/DevApp.test.tsx`
Expected: FAIL — no "LLM Logs" text anywhere, `hotKeysFor` call site doesn't
compile (missing `isLogsCategory`), no session-log wiring in `startPlay`.

**Step 3: Write minimal implementation**

In `src/tui/DevApp.tsx`:

1. New imports:

```ts
import {
  listSessionLogs,
  readSessionLog,
  startSessionLog,
  type SessionLogHandle,
  type SessionLogListing,
} from "../llm/sessionLog.js";
import { renderSessionLogFields } from "./dev/renderSessionLog.js";
```

2. `INITIAL_SELECTION` gets a `logs: 0` entry.

3. New state (alongside the existing `useState` calls):

```ts
const [logEntries, setLogEntries] = useState<SessionLogListing[]>(() =>
  listSessionLogs(initialAdventure.meta.id),
);
const [sessionLogHandle, setSessionLogHandle] = useState<SessionLogHandle | undefined>();
```

4. `startPlay` mints a session log (dev source) and refreshes the listing:

```ts
async function startPlay(optionIndex: number) {
  const resumedFrom = optionIndex === 0 ? null : saves[optionIndex - 1]!;
  const state =
    resumedFrom === null
      ? newGameStateFor(adventure)
      : await loadGame(adventure.meta.id, resumedFrom);

  if (provider) {
    const handle = startSessionLog({
      adventureId: adventure.meta.id,
      source: "dev",
      provider: { kind: provider.kind, baseURL: provider.baseURL, model: provider.model },
      saveSlot,
      resumedFrom,
    });
    setSessionLogHandle(handle);
    setLogEntries(listSessionLogs(adventure.meta.id));
  }
  setPlayState(state);
  setSubmenuOpen(false);
  setFocus("play");
}
```

5. Generalize entry counting so `"logs"` uses `logEntries` instead of
   `entriesForCategory`'s (always-empty) result:

```ts
const entries = entriesForCategory(adventure, category);
const entryCount = category === "logs" ? logEntries.length : entries.length;
const index = entryCount === 0 ? 0 : Math.min(selection[category], entryCount - 1);
const currentEntry = category === "config" || category === "logs" ? undefined : entries[index];
const selectedLog = category === "logs" ? logEntries[index] : undefined;
const currentKey =
  category === "config"
    ? CONFIG_KEY
    : category !== "logs" && currentEntry
      ? entityKey(currentEntry.kind, currentEntry.id)
      : undefined;
```

6. Read the selected log's content (cheap enough to do inline per render —
   matches the design's "static snapshot" answer, no live-update machinery
   needed):

```ts
const logContent: { records: ReturnType<typeof readSessionLog>; error: string | null } =
  category === "logs" && selectedLog
    ? (() => {
        try {
          return { records: readSessionLog(selectedLog.path), error: null };
        } catch (err) {
          return { records: [], error: err instanceof Error ? err.message : String(err) };
        }
      })()
    : { records: [], error: null };
```

7. `fieldRows` gets a `"logs"` branch:

```ts
const fieldRows: FieldRow[] =
  category === "config"
    ? renderConfigFields(adventure)
    : category === "logs"
      ? renderSessionLogFields(logContent.records)
      : (() => {
          const entry = entries[index];
          if (!entry) return [];
          const entity = findEntity(adventure, entry);
          return entity ? renderFieldsFor(category, entity) : [];
        })();
```

8. Replace every remaining `entries.length` bound-check in the `useInput`
   handler with `entryCount`, and guard `e` against the logs category:

```ts
if (key.downArrow && entryCount > 0) {
  setSelection((s) => ({ ...s, [category]: Math.min(entryCount - 1, index + 1) }));
  setScroll(0);
  return;
}
if (key.upArrow && entryCount > 0) {
  setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
  setScroll(0);
  return;
}
if (input === "e" && category !== "logs") {
  editSelected();
  return;
}
```

9. `hotKeysFor` call gets `entryCount` (instead of `entries.length`) and the
   new `isLogsCategory` field:

```ts
const hotKeys = hotKeysFor({
  focus,
  submenuOpen,
  entryCount,
  isConfigCategory: category === "config",
  isLogsCategory: category === "logs",
  hasLiveSession: playState !== null,
  canPlay,
  canScrollContent,
});
```

10. Sidebar list rendering: unify entities and log entries into one row
    shape just before the JSX, replacing the current `entries.map(...)`
    block:

```ts
interface SidebarRow { key: string; label: string; broken: boolean }

function logLabel(entry: SessionLogListing): string {
  return `${entry.startedAt} · ${entry.source}`;
}

const sidebarRows: SidebarRow[] =
  category === "logs"
    ? logEntries.map((l) => ({ key: l.file, label: logLabel(l), broken: false }))
    : entries.map((e) => ({
        key: entityKey(e.kind, e.id),
        label: e.label,
        broken: Boolean(issues[entityKey(e.kind, e.id)]),
      }));
```

Replace:

```jsx
{entries.map((e, i) => {
  const broken = Boolean(issues[entityKey(e.kind, e.id)]);
  return (
    <Text key={`${e.kind}:${e.id}`} bold={i === index} color={broken ? "red" : i === index ? "cyan" : undefined}>
      {i === index ? "› " : "  "}
      {e.label}
      {broken ? " ⚠" : ""}
    </Text>
  );
})}
```

with:

```jsx
{sidebarRows.map((row, i) => (
  <Text key={row.key} bold={i === index} color={row.broken ? "red" : i === index ? "cyan" : undefined}>
    {i === index ? "› " : "  "}
    {row.label}
    {row.broken ? " ⚠" : ""}
  </Text>
))}
```

11. Content pane: add a branch for a log read error, ahead of the existing
    `currentIssues` branch:

```jsx
{submenuOpen ? (
  /* unchanged */
) : playState && provider && makeModel && listModels ? (
  <App
    /* ...existing props..., plus: */
    sessionLog={sessionLogHandle}
  />
) : category === "logs" && logContent.error ? (
  <>
    <Text color="red">⚠ Could not read log:</Text>
    <Text color="red">{logContent.error}</Text>
  </>
) : currentIssues ? (
  /* unchanged */
) : (
  /* unchanged */
)}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/tui/DevApp.test.tsx`
Expected: PASS (all new + pre-existing tests green)

**Step 5: Commit**

```bash
git add src/tui/DevApp.tsx src/tui/DevApp.test.tsx
git commit -m "feat(tui): add the LLM Logs category to xyzzy dev

- RED: empty state, lists prior + freshly-started sessions, selecting one
  renders its content, e is a no-op, Edit hotkey omitted for logs
- GREEN: startPlay mints a SessionLogHandle; unified sidebarRows for entity
  vs log listing; fieldRows/entryCount branch on category === 'logs'
- Status: tests passing (full DevApp.test.tsx suite green)"
```

---

## Task 11: CLI — `xyzzy play --log-llm`

**Files:**
- Modify: `src/cli/commands/play.ts`
- Modify: `src/cli/index.ts`
- Test: `src/cli/commands/play.test.ts` (create if it doesn't already cover this — check first; `play.ts`/`dev.ts` currently have no dedicated test file per the existing convention of verifying CLI wiring manually, matching Task 7 of `IMPLEMENTATION_PLAN.md`'s prior entity-writer plan)

Since `play.ts`/`dev.ts` aren't unit-tested today (verified manually, like
`index.ts`), this task is verified manually too, consistent with existing
practice — do not invent a new test file convention here.

**Step 1: Modify `play.ts`**

```ts
import { startSessionLog } from "../../llm/sessionLog.js";

export interface PlayOptions {
  save?: string;
  provider?: string;
  logLlm?: boolean;
}

export async function play(path: string, opts: PlayOptions): Promise<void> {
  const adventure = await loadAdventure(path);
  const adventureDir = dirname(resolveAdventureFile(path));

  const provider = await resolveProvider({ providerFlag: opts.provider, adventureDir });
  const providers = (await readGlobalConfig()).providers;

  const slot = opts.save ?? DEFAULT_SLOT;
  const resumedFrom = opts.save && saveExists(adventure.meta.id, slot) ? slot : null;
  const state =
    resumedFrom !== null
      ? await loadGame(adventure.meta.id, resumedFrom)
      : newGameState(adventure, new Date().toISOString());

  const sessionLog = opts.logLlm
    ? startSessionLog({
        adventureId: adventure.meta.id,
        source: "play",
        provider: { kind: provider.kind, baseURL: provider.baseURL, model: provider.model },
        saveSlot: slot,
        resumedFrom,
      })
    : undefined;

  log.info("play started", {
    adventure: adventure.meta.id,
    provider: { kind: provider.kind, baseURL: provider.baseURL, model: provider.model },
    slot,
  });

  const { waitUntilExit } = render(
    createElement(App, {
      adventure,
      initialState: state,
      provider,
      makeModel: createModel,
      makeDetector: createDetector,
      listModels,
      providers,
      saveSlot: slot,
      sessionLog,
    }),
  );
  await waitUntilExit();
  process.exit(0);
}
```

**Step 2: Wire the flag in `index.ts`**

```ts
program
  .command("play")
  .argument("<path>", "adventure directory")
  .option("--save <slot>", "resume a specific save slot")
  .option("--provider <name>", "provider to use for this session")
  .option("--log-llm", "record every detector/narrator LLM call to a session log file")
  .description("launch the play TUI")
  .action((path: string, opts: { save?: string; provider?: string; logLlm?: boolean }) =>
    play(path, opts),
  );
```

**Step 3: Verify manually**

```bash
bun run start -- play --help
```

Expected: help text lists `--log-llm`.

```bash
XDG_STATE_HOME=$(mktemp -d) bun run start -- play examples/cave-of-echoes --log-llm
```

Type `/quit` immediately. Then confirm a session log file exists:

```bash
find "$XDG_STATE_HOME"/xyzzy -name '*.jsonl'
```

Expected: one `.jsonl` file with a single `type: "session"` header line
(no turns attempted, so no turn lines).

Without `--log-llm`, repeat and confirm no `logs/` directory is created at
all.

**Step 4: Commit**

```bash
git add src/cli/commands/play.ts src/cli/index.ts
git commit -m "feat(cli): add --log-llm flag to xyzzy play

- Manually verified: help text, session file created only with the flag
- Status: build succeeds, no new automated test (play.ts/index.ts convention)"
```

---

## Task 12: Docs

**Files:**
- Modify: `README.md`
- Modify: `VERIFICATION_PLAN.md`

**README**: extend the `xyzzy dev` section with a description of the "LLM
Logs" sidebar category (what it shows, that it's read-only, where the files
live on disk), and add `--log-llm` to the `xyzzy play` flag list.

**VERIFICATION_PLAN.md**: add **Scenario 10**, following the existing
numbered format. Unlike Scenarios 1–8, this one *can* meaningfully exercise
LLM-call logging without a reachable model: a narrator call attempted against
an unreachable endpoint still produces a `turn` record with `ok: false` (the
error is exactly what makes this debugging view useful), so the scenario
below stays within this plan's "no local LLM server available" constraint.

```markdown
### Scenario 10: LLM debugging view (`xyzzy dev`'s "LLM Logs" category)

**Context**: `xyzzy dev` always records detector/narrator calls for its
embedded play sessions. A turn attempted with no reachable model still
produces a logged (failed) narrator call, so this is verifiable without a
live LLM — the same constraint every other scenario in this plan works under.

**Steps**:
1. Copy `examples/cave-of-echoes` to `/tmp/xyzzy-verify-logs`.
2. `export XYZZY_STATE=$(mktemp -d)`
3. In a real terminal: `XDG_STATE_HOME=$XYZZY_STATE bun run start -- dev /tmp/xyzzy-verify-logs`
4. Press `p`, then Enter to start a New Game.
5. Type a command (e.g. `look`) and press Enter; with no reachable model this fails — confirm the usual error banner appears (unchanged behavior).
6. Press `Escape` to return to the sidebar.
7. Press `Tab` until the "LLM Logs" category is selected.
8. Confirm exactly one session log entry appears, labeled with a timestamp and "dev".
9. Select it (it should already be selected) and confirm the content pane shows: the session header (source `dev`, save slot `autosave`), a "Turn 1" block with the typed input, and a narrator call entry marked failed with the error detail.
10. Confirm `e` does nothing while this category is selected, and the hotkey footer does not list `Edit`.
11. Press `q` to exit the tool.
12. `rm -rf /tmp/xyzzy-verify-logs "$XYZZY_STATE"`

**Success Criteria**:
- [ ] Step 8 shows exactly one log entry
- [ ] Step 9's content pane shows the header fields, the turn's input, and the failed narrator call's error detail
- [ ] Step 10: no `Edit` hotkey, `e` is inert
- [ ] No crash or unhandled exception at any point despite no reachable model

**If Blocked**: If no real TTY is available, stop and ask the developer to run this scenario, or note the limitation explicitly — same as Scenarios 5, 8, and 9.
```

**Commit**

```bash
git add README.md VERIFICATION_PLAN.md
git commit -m "docs: document the LLM Logs dev-TUI view and --log-llm flag

- README: xyzzy dev LLM Logs section, xyzzy play --log-llm flag
- VERIFICATION_PLAN.md: Scenario 10, verifiable without a reachable model"
```

---

## Task 13: Final pass

1. `bun run test` — all green.
2. `bun run vitest run --coverage` — confirm 90%/90%/85%/90% thresholds met
   for `src/llm/sessionLog.ts`, `src/tui/dev/renderSessionLog.ts`, and the
   touched portions of `src/tui/App.tsx`/`src/tui/DevApp.tsx`/
   `src/tui/dev/hotkeys.ts`/`src/tui/dev/entityCatalog.ts`. If anything falls
   short, add the missing test case rather than relaxing scope — in
   particular, double-check the `listSessionLogs` corrupt-header branch and
   the `readSessionLog` corrupt-line branch are both hit.
3. `bun run build` — zero errors.
4. `bun run lint` — zero errors/warnings.
5. Update `PROGRESS.md` with the final task entry, per `CLAUDE.md`'s format.
6. Final commit.
