# Turn and LLM Call Timing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Measure and log how long each turn takes (prompt submission until narration is handed to the renderer) and how long each individual LLM call takes (detector pre-pass, each narrator attempt), always to the disk log, and optionally live in the TUI via a `/timing` toggle.

**Architecture:** `runTurn` (`src/engine/turnLoop.ts`) times each individual detector/narrator call as it makes them, logs each one immediately, and returns an aggregated `TurnTiming` breakdown on `TurnResult`. `App.tsx`'s `submit()` times the whole turn (matching where its existing turn-lifecycle logging already lives), logs the per-turn summary, and holds the UI state for the `/timing` toggle and the last-shown breakdown.

**Tech Stack:** TypeScript, Ink (React for terminals), Vitest, `ink-testing-library`. See `docs/plans/2026-07-21-turn-timing-design.md` for the full design rationale.

---

### Task 1: `TurnTiming` + per-call timing in `runTurn`

**Files:**
- Modify: `src/engine/turnLoop.ts`
- Test: `src/engine/turnLoop.test.ts`

**Step 1: Write the failing tests**

Append this new `describe` block at the end of `src/engine/turnLoop.test.ts` (after the closing `});` of `describe("runTurn", ...)` on the last line):

```ts
describe("runTurn timing", () => {
  it("times the narrator call and reports no detector when none is configured", async () => {
    const model = new FakeNarratorModel([{ narration: "ok", actions: [] }]);
    const { timing } = await runTurn(deps(model), newGameState(adventure, "c"), "look");
    expect(timing.detectorMs).toBeNull();
    expect(timing.detectorCalls).toBe(0);
    expect(timing.narratorCalls).toBe(1);
    expect(typeof timing.narratorMs).toBe("number");
    expect(timing.narratorMs).toBeGreaterThanOrEqual(0);
  });

  it("times the detector call when one is configured", async () => {
    const model = new FakeNarratorModel([{ narration: "ok", actions: [] }]);
    const detector = new FakeDetector([
      { move: null, advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
    ]);
    const { timing } = await runTurn(
      { ...deps(model), detector },
      newGameState(adventure, "c"),
      "look",
    );
    expect(timing.detectorCalls).toBe(1);
    expect(typeof timing.detectorMs).toBe("number");
    expect(timing.detectorMs).toBeGreaterThanOrEqual(0);
  });

  it("still times a detector call that throws (turn degrades normally)", async () => {
    const model = new FakeNarratorModel([{ narration: "ok", actions: [] }]);
    const detector = { detect: () => Promise.reject(new Error("detector down")) };
    const { timing, state } = await runTurn(
      { ...deps(model), detector },
      newGameState(adventure, "c"),
      "look",
    );
    expect(timing.detectorCalls).toBe(1);
    expect(typeof timing.detectorMs).toBe("number");
    expect(state.location).toBe("start"); // degraded, unaffected by the throw
  });

  it("sums both narrator attempts when the empty-narration retry fires", async () => {
    const model = new FakeNarratorModel([
      { narration: "", actions: [] },
      { narration: "second try", actions: [] },
    ]);
    const { timing } = await runTurn(deps(model), newGameState(adventure, "c"), "look");
    expect(timing.narratorCalls).toBe(2);
    expect(typeof timing.narratorMs).toBe("number");
  });

  it("propagates a narrator error after timing that attempt", async () => {
    const model = { generate: () => Promise.reject(new Error("boom")) };
    await expect(
      runTurn(deps(model), newGameState(adventure, "c"), "look"),
    ).rejects.toThrow("boom");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test src/engine/turnLoop.test.ts`
Expected: FAIL — `timing` does not exist on the `TurnResult` returned by `runTurn`.

**Step 3: Implement**

In `src/engine/turnLoop.ts`, update the import on line 3 to also bring in `NarratorResult`:

```ts
import type { NarratorContext, NarratorModel, NarratorResult } from "../llm/NarratorModel.js";
```

Add a new `TurnTiming` interface immediately before `export interface TurnResult` (currently lines 179–182), and add a `timing` field to `TurnResult`:

```ts
/** Wall-clock breakdown of one turn's LLM calls, for the disk log and the
 * optional `/timing` display. `detectorMs`/`detectorCalls` stay `null`/`0`
 * when no detector is configured; `narratorCalls` is 2 only when the
 * empty-narration retry fired. */
export interface TurnTiming {
  detectorMs: number | null;
  detectorCalls: number;
  narratorMs: number;
  narratorCalls: number;
}

export interface TurnResult {
  narration: string;
  state: GameState;
  timing: TurnTiming;
}
```

Add this helper function directly above `export async function runTurn` (currently line 282):

```ts
/**
 * Time one `model.generate()` attempt and log it immediately, regardless of
 * outcome — a call that throws is still worth knowing the duration of.
 */
async function timedGenerate(
  model: NarratorModel,
  context: NarratorContext,
  turn: number,
  attempt: number,
): Promise<{ result: NarratorResult; ms: number }> {
  const start = Date.now();
  try {
    const result = await model.generate(context);
    const ms = Date.now() - start;
    log.info("narrator call", { turn, attempt, ms, ok: true });
    return { result, ms };
  } catch (err) {
    const ms = Date.now() - start;
    log.info("narrator call", { turn, attempt, ms, ok: false });
    throw err;
  }
}
```

Replace the entire body of `runTurn` (currently lines 282–381) with:

```ts
export async function runTurn(
  deps: TurnDeps,
  state: GameState,
  input: string,
): Promise<TurnResult> {
  const { adventure, model } = deps;
  const now = deps.clock ? deps.clock() : new Date().toISOString();
  const window = deps.transcriptWindow ?? DEFAULT_TRANSCRIPT_WINDOW;
  const nextTurn = state.turn + 1;

  // --- Detection pre-pass: decide movement + beats deterministically before
  // narration, apply them, and narrate against the resulting `midState`. On any
  // detector failure we degrade to no detection and continue (`midState` = state).
  let midState = state;
  let detectorMs: number | null = null;
  let detectorCalls = 0;
  if (deps.detector) {
    detectorCalls = 1;
    const detectorStart = Date.now();
    try {
      const detection = await deps.detector.detect(
        buildDetectionContext(adventure, state, input),
      );
      const detected: unknown[] = [];
      if (detection.move) detected.push({ type: "moveTo", room: detection.move });
      for (const id of detection.advancedBeats) {
        detected.push({ type: "advanceBeat", beatId: id });
      }
      for (const { charId, beatId } of detection.advancedCharacterBeats) {
        detected.push({ type: "advanceCharacterBeat", charId, beatId });
      }
      for (const { charId, interactionId } of detection.triggeredInteractions) {
        detected.push({ type: "triggerInteraction", charId, interactionId });
      }
      const detectedActions = processActions(adventure, state, detected);
      midState = reduceAll(
        state,
        expandBeatEffects(adventure, state, detectedActions),
      );
      detectorMs = Date.now() - detectorStart;
      log.info("detector call", { turn: nextTurn, ms: detectorMs, ok: true });
    } catch (err) {
      detectorMs = Date.now() - detectorStart;
      log.info("detector call", { turn: nextTurn, ms: detectorMs, ok: false });
      log.warn(
        "detection failed; continuing without it",
        describeError(err),
      );
    }
  }

  const context: NarratorContext = {
    systemPrompt: buildSystemPrompt(adventure),
    digest: buildDigest(adventure, midState),
    transcript: windowTranscript(midState.transcript, window),
    input,
  };

  // Call the model; retry once if it produces no narration. Each attempt is
  // timed and logged individually by `timedGenerate`; the two are summed
  // below for the turn-level timing summary.
  const first = await timedGenerate(model, context, nextTurn, 1);
  let result = first.result;
  let narratorMs = first.ms;
  let narratorCalls = 1;
  if (result.narration.trim() === "") {
    const retry = await timedGenerate(model, context, nextTurn, 2);
    result = retry.result;
    narratorMs += retry.ms;
    narratorCalls = 2;
    if (result.narration.trim() === "") throw new EmptyNarrationError();
  }

  // When a detector is configured it owns moveTo/advanceBeat, so drop any the
  // narration model emits; without a detector the narration model still owns
  // them (legacy behavior). This gates on the detector's *presence*, not on the
  // detection succeeding: if detect() failed above, movement is intentionally
  // forfeited for this turn rather than handed back to the unreliable narration
  // path this feature exists to replace. Process the rest against `midState`.
  const excluded: ReadonlyArray<Action["type"]> = deps.detector
    ? DETECTION_OWNED_ACTIONS
    : [];
  const actions = processActions(adventure, midState, result.actions, excluded);

  // Expand each advanced beat into its authored effects so they apply
  // atomically with the beat flag (idempotent: skipped if already advanced).
  const reduced = reduceAll(
    midState,
    expandBeatEffects(adventure, midState, actions),
  );

  // The engine owns the exits line. Strip any "Exits: …" the model copied from
  // the digest (often truncated and with internal ids), then append the
  // authoritative, complete list so the player always sees every way out.
  const prose = stripProseExits(result.narration);
  const footer = exitsFooter(adventure, reduced);
  const narration = footer
    ? `${prose.trimEnd()}\n\n${footer}`.trim()
    : prose;

  let transcript = appendMessage(reduced.transcript, {
    role: "player",
    text: input,
    turn: nextTurn,
  });
  transcript = appendMessage(transcript, {
    role: "narrator",
    text: narration,
    turn: nextTurn,
  });

  return {
    narration,
    state: { ...reduced, turn: nextTurn, transcript, updatedAt: now },
    timing: { detectorMs, detectorCalls, narratorMs, narratorCalls },
  };
}
```

Note: `nextTurn` is now computed once at the top from `state.turn + 1` instead of `midState.turn + 1` further down — the reducer never touches the `turn` field (only the final assignment does, per its own doc comment), so `midState.turn === state.turn` throughout and this is a behavior-preserving move. It also gives every timing log line in this turn (detector, each narrator attempt) a shared `turn` id to correlate by, before `nextTurn` existed this early.

**Step 4: Run the full suite**

Run: `bun run test src/engine/turnLoop.test.ts`
Expected: PASS (existing tests + 5 new).

**Step 5: Full gate + commit**

```bash
bun run test && bun run typecheck && bun run lint
git add src/engine/turnLoop.ts src/engine/turnLoop.test.ts
git commit -m "Time detector and narrator calls in runTurn"
```

---

### Task 2: Turn-level timing, `/timing` command, and summary logging in `App.tsx`

**Files:**
- Modify: `src/tui/App.tsx`
- Test: `src/tui/App.test.tsx`

**Step 1: Write the failing tests**

Update the imports at the top of `src/tui/App.test.tsx`:

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./App.js";
import { newGameState } from "../engine/state.js";
import { FakeNarratorModel, type NarratorModel } from "../llm/NarratorModel.js";
import { FakeDetector, type Detector } from "../llm/Detector.js";
import type { Adventure } from "../world/schema.js";
import type { ProviderConfig } from "../config/schema.js";
import { logPath } from "../util/log.js";
```

Append these new `describe` blocks at the end of the file (after the closing `});` of `describe("App", ...)`):

```ts
describe("turn timing logging", () => {
  const savedState = process.env.XDG_STATE_HOME;

  beforeEach(() => {
    process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-tui-log-"));
  });
  afterEach(() => {
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  });

  function readLog(): Record<string, unknown>[] {
    return readFileSync(logPath(), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  }

  it("logs a turn timing summary after a successful turn", async () => {
    const model = new FakeNarratorModel([{ narration: "You look around.", actions: [] }]);
    const { stdin, unmount } = mount(model);

    await type(stdin, "look");
    await expect
      .poll(() => readLog().some((r) => r.message === "turn timing"))
      .toBe(true);

    const rec = readLog().find((r) => r.message === "turn timing")!;
    const detail = rec.detail as Record<string, unknown>;
    expect(detail).toMatchObject({
      turn: 1,
      detectorCalls: 0,
      detectorMs: null,
      narratorCalls: 1,
      ok: true,
    });
    expect(typeof detail.totalMs).toBe("number");
    expect(typeof detail.narratorMs).toBe("number");
    unmount();
  });

  it("logs a turn timing summary (ok: false) when the turn fails", async () => {
    const model: NarratorModel = { generate: () => Promise.reject(new Error("boom")) };
    const { stdin, unmount } = mount(model);

    await type(stdin, "look");
    await expect
      .poll(() => readLog().some((r) => r.message === "turn timing"))
      .toBe(true);

    const rec = readLog().find((r) => r.message === "turn timing")!;
    const detail = rec.detail as Record<string, unknown>;
    expect(detail).toMatchObject({ turn: 1, ok: false });
    expect(typeof detail.totalMs).toBe("number");
    unmount();
  });
});

describe("/timing command", () => {
  it("toggles the timing display on and off", async () => {
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel());

    await type(stdin, "/timing");
    await expect.poll(() => lastFrame()).toContain("Timing display on.");

    await type(stdin, "/timing");
    await expect.poll(() => lastFrame()).toContain("Timing display off.");

    await type(stdin, "/timing on");
    await expect.poll(() => lastFrame()).toContain("Timing display on.");

    await type(stdin, "/timing off");
    await expect.poll(() => lastFrame()).toContain("Timing display off.");
    unmount();
  });

  it("/help lists /timing", async () => {
    const { lastFrame, stdin, unmount } = mount(new FakeNarratorModel());
    await type(stdin, "/help");
    await expect.poll(() => lastFrame()).toContain("/timing");
    unmount();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test src/tui/App.test.tsx`
Expected: FAIL — no `"turn timing"` log entry is written, and `/timing` is an unknown command.

**Step 3: Implement**

In `src/tui/App.tsx`, update the import on line 8:

```ts
import { runTurn, type TurnTiming } from "../engine/turnLoop.js";
```

Add a `Timing` type alias right after the `Line` type (currently line 76):

```ts
type Line = { key: number; role: "player" | "narrator" | "system"; text: string };

/** A completed turn's timing breakdown: `TurnTiming` plus the measured wall-clock total. */
type Timing = TurnTiming & { totalMs: number };
```

Add a line to the `HELP` array (currently lines 84–99), right after the `/log` line:

```ts
  "/log                show the log file path",
  "/timing [on|off]    toggle turn/LLM-call timing display",
  "/help               show this help",
```

Add two new pieces of state right after the `history` state (currently line 152):

```ts
  const [history, setHistory] = useState<string[]>([]);
  const [timingEnabled, setTimingEnabled] = useState(false);
  const [lastTiming, setLastTiming] = useState<Timing | null>(null);
```

Add a `/timing` case to the `handleMeta` switch, right after the `/log` case (currently lines 205–207):

```ts
      case "/log":
        push("system", `Log file: ${logPath()}`);
        return true;
      case "/timing": {
        const next = arg === "on" ? true : arg === "off" ? false : !timingEnabled;
        setTimingEnabled(next);
        push("system", `Timing display ${next ? "on" : "off"}.`);
        return true;
      }
```

Replace the body of `submit()`'s turn-taking branch (currently lines 332–347) with:

```ts
    push("player", `> ${value}`);
    setBusy(true);
    const turnStart = Date.now();
    const attemptedTurn = state.turn + 1;
    try {
      const result = await runTurn({ adventure, model, detector }, state, value);
      const totalMs = Date.now() - turnStart;
      setState(result.state);
      setLastTiming({ ...result.timing, totalMs });
      log.info("turn timing", {
        turn: attemptedTurn,
        totalMs,
        ...result.timing,
        ok: true,
      });
      push("narrator", result.narration);
      await saveGame(adventureDir, saveSlot, result.state);
    } catch (err) {
      // Turn rolled back: state is unchanged. Log full provider detail
      // (statusCode, responseBody, cause) to disk; show a concise line here.
      log.info("turn timing", {
        turn: attemptedTurn,
        totalMs: Date.now() - turnStart,
        ok: false,
      });
      log.error(`turn failed: ${value}`, err);
      setError(`${userMessage(err)} · details in ${logPath()}`);
    } finally {
      setBusy(false);
    }
```

**Step 4: Run the full suite**

Run: `bun run test src/tui/App.test.tsx`
Expected: PASS (existing tests + 4 new).

**Step 5: Full gate + commit**

```bash
bun run test && bun run typecheck && bun run lint
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "Add /timing command and log a per-turn timing summary"
```

---

### Task 3: Render the timing line in the TUI

**Files:**
- Modify: `src/tui/App.tsx`
- Test: `src/tui/App.test.tsx`

**Step 1: Write the failing tests**

Append this new `describe` block at the end of `src/tui/App.test.tsx`:

```ts
describe("timing display", () => {
  it("formatDuration renders whole seconds with a decimal, except exactly 1 second", () => {
    expect(formatDuration(1000)).toBe("1 second");
    expect(formatDuration(2500)).toBe("2.5 seconds");
    expect(formatDuration(1500)).toBe("1.5 seconds");
    expect(formatDuration(3000)).toBe("3.0 seconds");
  });

  it("formatTimingLine matches the designed format, with and without a detector", () => {
    expect(
      formatTimingLine({
        totalMs: 2500,
        detectorMs: 1000,
        detectorCalls: 1,
        narratorMs: 1500,
        narratorCalls: 1,
      }),
    ).toBe("Turn 2.5 seconds (detector - 1 second, narrator - 1.5 seconds)");

    expect(
      formatTimingLine({
        totalMs: 1500,
        detectorMs: null,
        detectorCalls: 0,
        narratorMs: 1500,
        narratorCalls: 1,
      }),
    ).toBe("Turn 1.5 seconds (narrator - 1.5 seconds)");
  });

  it("does not show the timing line by default", async () => {
    const model = new FakeNarratorModel([{ narration: "You look around.", actions: [] }]);
    const { lastFrame, stdin, unmount } = mount(model);
    await type(stdin, "look");
    await expect.poll(() => lastFrame()).toContain("You look around.");
    expect(lastFrame()).not.toContain("Turn "); // capital T — distinct from the "turn N" status bar
    unmount();
  });

  it("shows the timing breakdown after a turn once enabled, without a detector clause", async () => {
    const model = new FakeNarratorModel([{ narration: "You look around.", actions: [] }]);
    const { lastFrame, stdin, unmount } = mount(model);

    await type(stdin, "/timing on");
    await type(stdin, "look");

    await expect.poll(() => lastFrame()).toMatch(/Turn \d+(\.\d)? seconds? \(narrator - /);
    expect(lastFrame()).not.toContain("detector -");
    unmount();
  });

  it("includes the detector clause when a detector is configured", async () => {
    const model = new FakeNarratorModel([{ narration: "You look around.", actions: [] }]);
    const makeDetector = () =>
      new FakeDetector([
        { move: null, advancedBeats: [], advancedCharacterBeats: [], triggeredInteractions: [] },
      ]);
    const { lastFrame, stdin, unmount } = mount(
      model,
      () => model,
      undefined,
      undefined,
      makeDetector,
    );

    await type(stdin, "/timing on");
    await type(stdin, "look");

    await expect.poll(() => lastFrame()).toContain("detector -");
    unmount();
  });

  it("keeps showing the last successful turn's timing after a failed turn", async () => {
    let calls = 0;
    const model: NarratorModel = {
      async generate() {
        calls++;
        if (calls === 1) return { narration: "You look around.", actions: [] };
        throw new Error("boom");
      },
    };
    const { lastFrame, stdin, unmount } = mount(model);

    await type(stdin, "/timing on");
    await type(stdin, "look");
    await expect.poll(() => lastFrame()).toContain("You look around.");
    expect(lastFrame()).toMatch(/Turn \d/);

    await type(stdin, "push rock");
    await expect.poll(() => lastFrame()).toContain("boom");
    expect(lastFrame()).toMatch(/Turn \d/); // timing line persists through the failed turn
    unmount();
  });
});
```

Update the `App` import at the top of the file to also bring in the two new exports:

```ts
import { App, formatDuration, formatTimingLine } from "./App.js";
```

**Step 2: Run tests to verify they fail**

Run: `bun run test src/tui/App.test.tsx`
Expected: FAIL — `formatDuration`/`formatTimingLine` don't exist, and no timing line renders.

**Step 3: Implement**

In `src/tui/App.tsx`, add these two exported helpers right after the `Timing` type alias added in Task 2:

```ts
/** Render a millisecond duration as "1 second" (singular, whole seconds) or
 * "N.N seconds" (one decimal place) otherwise. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms) / 1000;
  const rounded = Math.round(seconds * 10) / 10;
  return rounded === 1 ? "1 second" : `${rounded.toFixed(1)} seconds`;
}

/** e.g. "Turn 2.5 seconds (detector - 1 second, narrator - 1.5 seconds)". */
export function formatTimingLine(timing: Timing): string {
  const parts = [`narrator - ${formatDuration(timing.narratorMs)}`];
  if (timing.detectorCalls > 0) {
    parts.unshift(`detector - ${formatDuration(timing.detectorMs ?? 0)}`);
  }
  return `Turn ${formatDuration(timing.totalMs)} (${parts.join(", ")})`;
}
```

In the component's render (currently lines 370–381), add a new `Box` between the status bar and the error line:

```tsx
      <Box>
        <Text dimColor>
          {adventure.meta.title} · {roomName(adventure, state)} · turn{" "}
          {state.turn}
        </Text>
      </Box>

      {timingEnabled && lastTiming && (
        <Box>
          <Text dimColor>{formatTimingLine(lastTiming)}</Text>
        </Box>
      )}

      {error && (
```

**Step 4: Run the full suite**

Run: `bun run test src/tui/App.test.tsx`
Expected: PASS (existing tests + 6 new).

**Step 5: Full gate + commit**

```bash
bun run test && bun run typecheck && bun run lint
git add src/tui/App.tsx src/tui/App.test.tsx
git commit -m "Render the turn timing breakdown when /timing is enabled"
```

---

### Task 4: Manual verification + full gate

**Files:** none (verification only)

**Steps:**

1. Manual smoke test against a local model (adjust the model name to one you have pulled in `ollama`):
   ```bash
   bun run start play examples/cave-of-echoes
   ```
   Take a turn, then run `/timing on`. Confirm a line like
   `Turn 2.5 seconds (narrator - 2.5 seconds)` appears under the status bar
   after the next turn (no `detector -` clause unless a detector is
   configured for the active provider). Run `/timing off` and confirm the
   line disappears on the next turn. Run `/log`, open the reported file, and
   confirm `"detector call"` / `"narrator call"` / `"turn timing"` JSON lines
   are present for the turns just taken.
2. Full gate:
   ```bash
   bun run test && bun run typecheck && bun run lint
   ```

---

## Verification checklist

- [ ] `runTurn` returns a `TurnTiming` breakdown; `detectorMs`/`detectorCalls` are `null`/`0` with no detector configured.
- [ ] A detector call that throws is still timed; the turn still degrades to no detection as before.
- [ ] The empty-narration retry sums both narrator attempts into `narratorMs`/`narratorCalls: 2`.
- [ ] Each detector/narrator call is logged individually (`"detector call"` / `"narrator call"`) as it happens.
- [ ] Every turn — success or failure — logs one `"turn timing"` summary.
- [ ] `/timing`, `/timing on`, `/timing off` all work; `/help` lists `/timing`.
- [ ] The timing line is hidden by default, shown after `/timing on`, and correctly includes/omits the `detector -` clause.
- [ ] A failed turn doesn't clear a previously-shown timing line.
- [ ] `bun run test && bun run typecheck && bun run lint` all green.
- [ ] Manual: `/timing on` in a live `play` session shows the breakdown and the log file has the new entries.
