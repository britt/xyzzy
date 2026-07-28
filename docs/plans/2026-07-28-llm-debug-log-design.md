# LLM Debugging View — Design

## Problem

`xyzzy dev` and `xyzzy play` both drive `runTurn()`, which makes one optional
detector call and one-or-two narrator calls per turn. Right now the only
record of these calls is a timing-only line in the global diagnostic log
(`util/log.ts`) — no system prompt, no digest, no raw model response. When a
turn narrates wrong or an action fails to apply, there's no way to see what
was actually sent to (or returned by) the model without re-running with extra
instrumentation by hand.

This adds a persistent, per-play-session log of every LLM interaction, and a
new "LLM Logs" section in the `xyzzy dev` sidebar to browse and inspect them.

## Scope & lifecycle

- **Where it's wired in**: `xyzzy dev`'s embedded play session always logs.
  `xyzzy play` only logs when passed a new `--log-llm` flag. Both paths share
  `App.tsx`/`runTurn`, so the capture mechanism lives at the `App` component
  boundary, gated by an optional prop — always populated from `DevApp`,
  populated only when the flag is set from `play.ts`.
- **Session boundary**: one log file per *play session*, where "session" =
  one mount of the embedded/standalone `App` from a single "New Game" or
  "Resume" action. In `DevApp`, pressing `p` to re-focus an already-running
  session does **not** start a new log (it reuses the same session); only
  `startPlay()` (New Game or Resume from the submenu) mints a fresh one. In
  standalone `xyzzy play`, the whole CLI invocation is one session, so one
  file per run.
- **Granularity inside a file**: one JSON record per turn, bundling that
  turn's detector call (if a detector is configured) and narrator call(s)
  (including the empty-narration retry, if it fired) together.
- **View only**: no re-run/replay action from the UI — this is strictly a
  read-only debugging view.
- **Best-effort**: matching the existing philosophy in `util/log.ts`, a
  failure to write a log entry must never break gameplay — logging wraps in
  try/catch and silently no-ops on disk errors, same as today's diagnostic
  logger.

## File format & location

- **Location**: `$XDG_STATE_HOME/xyzzy/<adventure-id>/logs/` (default
  `~/.local/state/xyzzy/<adventure-id>/logs/` when `XDG_STATE_HOME` is
  unset), reusing the same base-dir resolution `util/log.ts` already has for
  the global diagnostic log. `<adventure-id>` is `adventure.meta.id`.
- **Filename**: an ISO-ish timestamp taken when the session starts, sanitized
  for filesystem safety (colons → `-`), e.g. `2026-07-28T14-32-07.jsonl`.
  Sortable by name, so listing the directory and reverse-sorting gives
  newest-first with no extra parsing.
- **Format**: JSONL, one JSON object per line, append-only (crash-safe — a
  session that dies mid-turn still leaves prior turns readable):
  - **Line 1 — session header**:
    `{ type: "session", startedAt, adventure: <id>, source: "dev" | "play", provider: { kind, baseURL, model }, saveSlot, resumedFrom: <slot | null> }`.
    Written the moment the session starts, before any turn — so a session
    that errors before the first input still leaves a file explaining what
    was attempted.
  - **Line 2+ — one per turn**:
    `{ type: "turn", turn, input, detector: CallLog[] | undefined, narrator: CallLog[] }`,
    where `CallLog = { context, ms, ok: true, result } | { context, ms, ok: false, error }`.
    `context` is the exact `DetectionContext`/`NarratorContext` sent (system
    prompt, digest, transcript window, input); `result` is the raw
    `Detection`/`NarratorResult`; `error` is run through the existing
    `describeError()` for consistency with the main log. `narrator` is an
    array so a retry (2 attempts) shows as two entries under the same turn.
- **New module**: `src/llm/sessionLog.ts` owns this — path resolution, the
  header/turn record types, and the recording wrapper.

## Capture mechanism

- **`SessionRecorder`** (in `sessionLog.ts`): a small class holding two
  buffers (`pendingDetector`, `pendingNarrator`) plus two wrapping methods:
  - `wrapDetector(detector: Detector): Detector` — returns a `Detector` whose
    `detect()` times the call, pushes `{ context, ms, ok, result | error }`
    onto `pendingDetector`, and forwards the real call (rethrowing on failure
    so `runTurn`'s existing error handling is untouched).
  - `wrapModel(model: NarratorModel): NarratorModel` — same shape for
    `generate()`, pushing onto `pendingNarrator`.
  - `flushTurn(turn, input): TurnRecord` — snapshots both buffers into one
    turn record, clears them, returns it for the caller to append to disk.
- **Why wrapping, not touching `turnLoop.ts`**: `runTurn` already takes a
  plain `model`/`detector` in `TurnDeps`; wrapping them before they're passed
  in captures every call with zero changes to engine logic, retry handling,
  or existing tests. Buffering-then-flush-per-turn works safely because
  `App.tsx`'s `busy` guard already ensures only one `runTurn` is ever in
  flight at a time — no risk of one turn's calls leaking into another's
  buffer.
- **Wiring point**: `App.tsx` gets a new optional prop,
  `sessionLog?: SessionLogHandle` (open file handle/path + a
  `SessionRecorder`). When present: `buildModel`/`buildDetector` wrap their
  output through the recorder before use, and `submit()` calls
  `sessionLog.appendTurn(recorder.flushTurn(attemptedTurn, value))` right
  after `runTurn` settles (success or failure — a failed turn is still worth
  seeing). When absent, `App` behaves exactly as today, zero overhead.
- **Who creates the handle**: `DevApp.startPlay()` creates a fresh one on
  every New-Game/Resume and passes it into `<App sessionLog={...}>`;
  `play.ts` creates one only if `opts.logLlm` is set, once, at startup.

## Sidebar & content pane

- **New category**: `"logs"` added to `DevApp`'s fixed sidebar (`Tab` cycles
  through it alongside config/beats/characters/rooms/items), labeled "LLM
  Logs". Because a session-log entry isn't an `EntityKind`-shaped thing (no
  id collisions, no `$EDITOR` target, no validation issues), it's *not*
  forced through `CatalogEntry`/`entriesForCategory` — `DevApp` keeps a
  separate `logEntries` list (one per `.jsonl` file found under the
  adventure's log dir, newest first, label built from the header line's
  `startedAt` + `source`), read once on mount and refreshed whenever a new
  session starts (so a log you just finished playing shows up without
  restarting `xyzzy dev`).
- **Selection**: `↑`/`↓` navigate `logEntries` the same way they navigate
  entity lists when `category === "logs"`. No `e` (edit) — that hotkey is a
  no-op here and omitted from the bottom hotkey bar for this category, since
  logs are read-only. No `⚠` glyphs — logs don't participate in the
  validation-issues map.
- **Content pane**: selecting a log reads and parses its full JSONL, then
  renders it through the same `DisplayLine`/scroll pipeline every other
  category already uses (`layoutFieldRows` → `ContentLine`), via a new
  formatter (`renderSessionLog(records): FieldRow[]`) rather than a raw JSON
  dump — session header first (start time, provider, save slot), then each
  turn as a labelled block: player input, detector call (context +
  result/error + ms) if present, narrator call(s) (context +
  narration/actions or error + ms). Existing PgUp/PgDn scrolling handles
  length, same as any other long entity.
- **Read failure**: an unreadable/corrupt log file shows the same inline
  error-banner treatment `editSelected()` already uses for a bad YAML file,
  rather than crashing the TUI.

## Edge cases & testing

- **No logs yet**: an adventure with no `logs/` directory (never played, or
  a fresh XDG state dir) shows the "LLM Logs" category with an empty list —
  same empty-state handling `entriesForCategory` already gives rooms/items/
  etc. with zero entities, not an error.
- **Directory creation**: `sessionLog.ts` creates `logs/` with
  `mkdirSync(..., { recursive: true })` the same way `util/log.ts` does, on
  first write.
- **Filename collisions**: two sessions starting within the same second
  (unlikely in practice — a session start is a deliberate user action) would
  collide on filename; low enough risk to not warrant complicating the
  design now, but worth a one-line note in the code rather than silently
  overwriting — a short random suffix can be added later if this turns out
  to matter in practice.
- **Testing shape** (per the project's TDD rules, each gets its own RED test
  first):
  - `sessionLog.test.ts`: header/turn record shape,
    `SessionRecorder.wrapModel`/`wrapDetector` buffering + flush (including
    the error-path record), file path resolution, directory auto-creation,
    listing/sorting session files.
  - `App.test.tsx`: when `sessionLog` prop is supplied, a turn (success and
    failure) results in exactly one appended turn record with the right
    shape; when omitted, no file I/O occurs at all (spy-verified).
  - `DevApp.test.tsx`: "logs" category appears in the Tab cycle, lists
    session files, selecting one renders its content, empty state when none
    exist, `e` is a no-op / omitted from hotkeys.
  - `renderSessionLog.test.ts` (alongside `renderFields.ts`'s existing test
    pattern): turn/session records → expected `FieldRow[]`.
  - CLI: `play.ts` only constructs/passes `sessionLog` when `--log-llm` is
    set; `dev.ts` always does.
