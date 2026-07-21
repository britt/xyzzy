# Turn and LLM call timing

**Date:** 2026-07-21
**Status:** Design, ready for implementation plan

## Problem

Turns can be slow, and when they are it's not obvious why: is the detector
pre-pass slow, is narration slow, did the empty-narration retry fire? Today
nothing measures wall-clock time anywhere in the turn loop, and the only place
diagnostics can go is the disk log (`util/log.ts`) — Ink owns the terminal
during `play`, so nothing can print to stdout/stderr without corrupting the
render.

## Goals

- Know how long each turn takes, from prompt submission until the response is
  handed to the renderer.
- Know how long each individual LLM call takes — the detector pre-pass and
  each narrator attempt (including the empty-narration retry) — not just the
  turn total.
- Always capture this to the log file, cheaply.
- Optionally surface it live in the TUI via a toggle command.

## Non-goals

- Precise terminal-paint timing (measuring until Ink has actually flushed
  pixels). "Until narration is handed to `push()`, before `saveGame`" is the
  practical boundary — good enough for a debugging feature.
- Aggregating/analyzing historical timings (e.g. `rtk gain`-style analytics).
  This just logs and displays; slicing the log file is a separate concern.
- Timing meta commands (`/model list`, `/save`, etc.) — only real turns.

## Architecture: split by who owns the boundary

Two places already own different halves of a turn:

- `turnLoop.ts`'s `runTurn` is the only place that calls `detector.detect()`
  and `model.generate()` — it can time each individual call as it happens. It
  already logs directly (`log.warn` for detection failure, rejected moves), so
  per-call logging fits its existing convention.
- `App.tsx`'s `submit()` owns "from prompt to rendered" — it already does the
  turn's lifecycle logging (`log.error("turn failed", ...)`). It's the natural
  place to log the per-turn summary and to hold UI state for the toggle.

So: `runTurn` measures and logs each individual LLM call, and returns an
aggregated breakdown on `TurnResult`. `App.tsx` measures the total turn and
logs the summary, using the breakdown `runTurn` returned.

## Data model

```ts
export interface TurnTiming {
  detectorMs: number | null; // null only when no detector configured at all
  detectorCalls: number;     // 0 = not configured, 1 = attempted (success or failure)
  narratorMs: number;        // sum across attempts
  narratorCalls: number;     // 1, or 2 if the empty-narration retry fired
}
```

`TurnResult` (in `turnLoop.ts`) gains `timing: TurnTiming`.

`detectorMs` is captured via `try { } finally { }` around `detector.detect()`,
so a slow call that then throws is still timed — `detectorCalls` stays 1 to
distinguish "attempted and failed" from "not configured" (`detectorCalls: 0`,
`detectorMs: null`).

`narratorMs`/`narratorCalls` sum both `model.generate()` calls if the
empty-narration retry fires; each attempt is timed separately at the log
level (see below) even though the summary only carries the sum.

Compute `const nextTurn = state.turn + 1` once at the top of `runTurn` (stable
through the function — the reducer never touches `turn`, only the final
assignment does) and use it as the correlation id on every timing log line,
including the per-turn summary logged later in `App.tsx`.

## Logging

Per-call, emitted from `runTurn` immediately after each call resolves or
throws:

```json
{"time":"...","level":"info","message":"detector call","detail":{"turn":5,"ms":1023,"ok":true}}
{"time":"...","level":"info","message":"narrator call","detail":{"turn":5,"attempt":1,"ms":1500,"ok":true}}
```

`ok:false` marks a call that threw. This is additive — the existing
`log.warn`/`log.error` for that failure still fires; this is purely a timing
record.

Per-turn summary, emitted from `App.tsx`'s `submit()`:

```json
{"time":"...","level":"info","message":"turn timing","detail":{"turn":5,"totalMs":2500,"detectorMs":1000,"detectorCalls":1,"narratorMs":1500,"narratorCalls":1,"ok":true}}
```

On a failed turn (`runTurn` throws), `submit()`'s existing `catch` block also
logs a `"turn timing"` entry with just `{ turn: nextTurn, totalMs, ok: false }`
— no breakdown available (no `TurnResult` was returned), but it's
correlatable via `turn` to the per-call logs already written before the
throw.

## `/timing` command and UI display

New `App.tsx` state:
- `timingEnabled: boolean` (default `false`)
- `lastTiming: (TurnTiming & { totalMs: number }) | null` (default `null`)

`/timing` (no arg) toggles; `/timing on` / `/timing off` sets explicitly.
Pushes a confirming system line, same pattern as `/model`/`/provider`. Add a
line to `HELP`.

In `submit()`, time the existing `runTurn(...)` call. On success:
`setLastTiming({ ...result.timing, totalMs })`, log the summary, then proceed
with the existing `push("narrator", ...)` / `saveGame`. On failure,
`lastTiming` is left untouched — the last successful turn's timing keeps
displaying rather than disappearing.

Render a new `Box` under the existing status-bar line, shown only when
`timingEnabled && lastTiming`. A formatter renders ms as `"1 second"` /
`"2.5 seconds"` (singular at exactly 1000ms, one decimal place otherwise), and
omits the `detector - ...` clause when `lastTiming.detectorCalls === 0`:

```
Turn 2.5 seconds (detector - 1 second, narrator - 1.5 seconds)
```
```
Turn 1.5 seconds (narrator - 1.5 seconds)
```

## Error handling summary

- Detector throws: timed via `finally`, `ok:false` logged, existing
  `log.warn("detection failed...")` and no-detection degradation unchanged.
- Narrator attempt throws outright (not just empty): per-call log fires with
  `ok:false` before the error propagates out of `runTurn`.
- Both narrator attempts return empty (`EmptyNarrationError`): both attempts
  get `ok:true` timing logs (they resolved, just empty), then `runTurn`
  throws — no `TurnResult`, so no per-turn summary from the success path;
  `App.tsx`'s catch logs the failure-path summary instead.

## Testing (TDD, no live LLM)

- `turnLoop.test.ts`: stub `Date.now` with `vi.spyOn(Date, "now")` returning a
  scripted sequence of values to deterministically assert `TurnResult.timing`
  — success, no-detector, detector-throws, narrator-retry cases.
  `FakeNarratorModel`/`FakeDetector` need no changes; they resolve
  immediately, so a scripted `Date.now` sequence is enough to fake elapsed
  time.
- `App.test.tsx`: `/timing` toggles the display line on/off; a completed turn
  renders `"Turn X seconds (...)"` in the expected format once enabled; the
  line is absent by default; a failed turn doesn't clear a previously-shown
  line.
- No other `runTurn` callers exist (confirmed via grep), so the `TurnResult`
  shape change is contained to `turnLoop.ts`, `App.tsx`, and their two test
  files.

## Future extensions

- Aggregate stats across turns (min/max/avg) if a `rtk gain`-style analytics
  view is ever wanted — out of scope here, but the log format is
  greppable/parseable enough to support it later without a schema change.
