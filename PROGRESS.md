# Progress

## Task: Fix silently broken published CLI (`npm install -g`) - COMPLETE

- Started: 2026-07-22 10:15 PDT
- Root cause: `src/cli/index.ts` gated `main()` on
  `import.meta.url === \`file://${process.argv[1]}\``. Node resolves
  `import.meta.url` through symlinks (realpath), but `process.argv[1]` is the
  path exactly as invoked. npm's global `bin` install is always a symlink on
  macOS/Linux, so the comparison never matched for any real global install —
  the CLI exited 0 with zero output, no error, and no indication anything was
  wrong. Reproduced against both a local `npm pack` install and the real
  published `@britt/xyzzy@0.2.0` package pulled from the npm registry.
- Tests: RED — added `src/cli/isMainModule.test.ts` (4 cases: match, mismatch,
  symlink-resolved match, path-with-spaces) against a not-yet-existing
  `isMainModule.ts`, confirmed it failed for the right reason (module not
  found). GREEN — implemented `src/cli/isMainModule.ts` using
  `url.pathToFileURL` instead of manual string interpolation, wired into
  `cli/index.ts` via `fs.realpathSync(process.argv[1])`. Full suite: 229
  passed, 1 todo, 0 failing.
- Coverage: `isMainModule.ts` 100% lines/branches/funcs/statements. Overall
  repo: Stmts 89.94%, Branch 85.24%, Funcs 93.22%, Lines 89.94% (pre-existing
  gaps in `new.ts`/`play.ts`/`validate.ts`/`scaffolder.ts` stubs are unrelated
  to this change; `cli/index.ts` itself is excluded from coverage per
  `vitest.config.ts`).
- Build: Successful (`bun run build`)
- Linting: Clean (`bun run lint`), typecheck clean (`bun run typecheck`)
- End-to-end verification: `npm pack` → `npm install -g --prefix <scratch>` →
  `./prefix/bin/xyzzy --help` now prints the real usage text instead of
  silently exiting; `./prefix/bin/xyzzy validate examples/cave-of-echoes`
  correctly validates and exits 0. Scratch directories cleaned up.
- Added Scenario 6 to `VERIFICATION_PLAN.md` (packaged global install
  pack/install/execute round-trip) so this class of bug — invisible to unit
  tests and to `bun run start`, both of which never go through a symlinked
  entry point — can't regress silently again. Also corrected a stale
  prerequisite claim in that doc asserting `bun run start` is equivalent to
  the published binary.
- Completed: 2026-07-22 10:38 PDT
- Notes: No changes needed to bundling/splitting/exec-bits/shebang — those
  were all already correct; the bug was purely the entry-point
  self-invocation guard.

## Task: Fail closed on a broken bin symlink instead of crashing - COMPLETE

- Started: 2026-07-22 10:47 PDT
- Root cause: code review flagged that `cli/index.ts` called
  `realpathSync(process.argv[1])` unconditionally at module load. A dangling
  npm global `bin` symlink (left behind by a partial install/uninstall) makes
  `realpathSync` throw, so the CLI would now crash with a raw Node stack trace
  at load time instead of the old silent no-op — a new, uncaught failure mode
  introduced by the previous fix.
- Tests: RED — added `src/cli/safeRealpath.test.ts` (3 cases against real
  temp files/dirs, no mocks: realpath of an existing file, undefined for a
  missing path, undefined for a broken symlink) against a not-yet-existing
  `safeRealpath.ts`; confirmed failure (module not found). GREEN —
  implemented `src/cli/safeRealpath.ts` wrapping `realpathSync` in
  try/catch, returning `undefined` on failure. Wired into `cli/index.ts` in
  place of the bare `realpathSync` call, so a resolution failure now fails
  closed (`main()` doesn't run) rather than throwing. Full suite: 232 passed,
  1 todo, 0 failing.
- Coverage: `safeRealpath.ts` 100% lines/branches/funcs/statements. Overall
  repo unchanged: Stmts 89.97%, Branch 85.28%, Funcs 93.27%, Lines 89.97%.
- Build: Successful (`bun run build`)
- Linting: Clean (`bun run lint`), typecheck clean (`bun run typecheck`)
- End-to-end verification: re-ran the Scenario 6 pack/install round-trip
  (`npm pack` → `npm install -g --prefix <scratch>` → `--help` and
  `validate`) to confirm the happy path still works after this change.
- Completed: 2026-07-22 10:52 PDT

## Task: Implement `xyzzy new` (scaffold command) - COMPLETE

- Started: 2026-07-23 07:50 PDT
- Scope: `src/world/scaffolder.ts` (`scaffoldAdventure`) and
  `src/cli/commands/new.ts` (`newAdventure`) were both stubs
  (`notImplemented`). `new <dir>` now scaffolds a minimal, schema-valid
  adventure and interactively prompts for the game's title (defaults to the
  directory name) and an optional premise (defaults to a placeholder string
  when skipped).
- Tests: RED first in both layers.
  - `src/world/scaffolder.test.ts` (9 cases) written against the stub,
    confirmed failing with `NotImplementedError` for the right reason.
    GREEN — implemented `scaffoldAdventure`: writes `adventure.yaml` (`meta`,
    `premise`, `start: {}`), a `README.md`, a `saves/` dir, and fully
    commented-out `rooms/example.yaml`, `items/example.yaml`,
    `characters/example.yaml`, `beats/example.yaml` (each parses to `null`,
    so they contribute zero real entities — validated via
    `readAdventureFile`/`validateAdventure`, no mocks). Refuses to overwrite
    an existing non-empty directory; slugifies the directory's basename into
    `meta.id` while the README's usage snippets reference the real directory
    name (caught and fixed as its own RED→GREEN cycle after the first
    implementation used the slug in both places).
  - `src/cli/commands/new.test.ts` (3 cases) written against the stub,
    confirmed failing the same way. GREEN — implemented `newAdventure` with
    an injectable `Prompter` interface for testability; production path uses
    `node:readline/promises`.
  - Manual end-to-end check with piped stdin (`printf 'Title\nPremise\n' |
    bun run start -- new ...`) surfaced a real bug: sequential
    `rl.question()` calls race against pre-buffered piped input (both lines
    already delivered before the second listener attaches, so it never
    resolves) — reproduced with plain Node too, not bun-specific. Fixed by
    pulling from `rl[Symbol.asyncIterator]()` one line at a time instead of
    two independent `question()` calls; re-verified with both piped stdin and
    a real `npm pack`/`npm install -g` packaged binary.
  - Removed `src/world/roadmap.test.ts` (an `it.todo` placeholder for this
    exact stub) now that real tests exist.
- Coverage: `scaffolder.ts` 100% lines/funcs/statements, 92.3% branch (one
  defensive fallback in `slugify` for an all-punctuation name, not
  exercised). `new.ts` 87%/50%/50%/87% (the real-stdin `stdinPrompter` path
  is exercised only manually/end-to-end, same convention as `play.ts`'s
  TTY-only code, which VERIFICATION_PLAN documents as requiring a real
  terminal). Overall repo: Stmts 90.5%, Branch 85.51%, Funcs 94.4%, Lines
  90.5% — meets the 90/85/90/90 thresholds.
- Build: Successful (`bun run build`)
- Linting: Clean (`bun run lint`), typecheck clean (`bun run typecheck`)
- End-to-end verification: `bun run start -- new <dir>` with piped answers
  produces a valid adventure that `bun run start -- validate <dir>` accepts;
  also re-ran the Scenario 6-style `npm pack` → `npm install -g --prefix
  <scratch>` → packaged `xyzzy new` → packaged `xyzzy validate` round-trip
  end to end. Scratch directories cleaned up.
- Completed: 2026-07-23 08:05 PDT
- Notes: Scenario 1 in `VERIFICATION_PLAN.md` currently documents `new` as an
  expected-fail stub — worth a follow-up doc update, but out of scope for
  this change since the instructions were to implement the command, not
  rewrite the verification plan.

## Task: Fix code review findings on PR #19 - COMPLETE

- Started: 2026-07-23 08:45 PDT
- Scope: two findings from a code review of PR #19 (`xyzzy new`).
- Finding 1 (medium): `assertDirIsWritable` threw a raw `ENOTDIR` Node error
  instead of the command's normal friendly message when the target path was
  an existing file rather than a directory (e.g. a typo'd path). Reproduced
  directly: `scaffoldAdventure({ dir: <path to a file>, title: "x" })` threw
  `ENOTDIR: not a directory, scandir '...'`.
  - Tests: RED — added a case to `src/world/scaffolder.test.ts` asserting a
    friendly `/already exists and is not a directory/i` message; confirmed it
    failed with the raw `ENOTDIR` message first. GREEN — `assertDirIsWritable`
    now calls `statSync(dir).isDirectory()` and throws the same
    `Refusing to scaffold into ...` style error used for the non-empty-dir
    case before falling through to `readdirSync`. Full suite: 245 passed, 0
    failing (was 244; net +1 test).
- Finding 2 (low): root `README.md`'s "Create an adventure" section still
  described the pre-implementation stub behavior — no mention of the
  interactive title/premise prompts, and said "room and character" examples
  when the scaffold also writes `items/` and `beats/` examples. Updated the
  paragraph to describe both. (Prettier's default run reformatted unrelated
  pre-existing lines elsewhere in the file — reverted that and hand-applied
  just the intended paragraph edit to keep the diff scoped to this fix.)
- Coverage: `scaffolder.ts` unchanged at 100% lines/funcs/statements; branch
  coverage improved (the new `isDirectory()` check is exercised by the new
  test). Overall repo thresholds still met.
- Build: Successful (`bun run build`)
- Linting: Clean (`bun run lint`), typecheck clean (`bun run typecheck`)
- End-to-end verification: re-ran `xyzzy new` against a path pointing at an
  existing plain file — now prints
  `Refusing to scaffold into ...: path already exists and is not a directory.`
  and exits 1, instead of a raw Node stack-trace-style error.
- Completed: 2026-07-23 08:52 PDT

## Task: `xyzzy new room|item|character|beat` entity subcommands - COMPLETE

- Started: 2026-07-23 (see `IMPLEMENTATION_PLAN.md`)
- Scope: adds `xyzzy new room|item|character|beat` alongside the existing
  `xyzzy new <name>` adventure scaffold. Each writes a new entity file into
  the adventure's conventional `<kind>s/` directory, with every field besides
  the name/id (`--description`, `--location`, `--persona`, `--trigger`)
  suppliable via flag, prompted interactively via an Ink form when in a real
  terminal, or left as a commented placeholder when skipped or run
  non-interactively.
- Tasks 1–9 followed strict RED→GREEN TDD, one commit per task:
  1. `src/util/slug.ts` — `slugify()`, 5 cases.
  2. `src/world/entityWriter.ts` — `ENTITY_FIELDS` + pure `renderEntityYaml`
     (all-supplied/all-skipped/mixed per kind), 9 cases.
  3. `entityWriter.ts` additive — `entityFilePath` (pluralized per-kind path)
     + `findEntityIdConflict` (reuses `loader.readAdventureFile` rather than
     re-scanning directories), 5 cases.
  4. `entityWriter.ts` additive — `writeEntityFile` (mkdir -p, refuse
     overwrite, refuse id conflict, refuse missing `adventure.yaml`, happy
     path all 4 kinds), 5 cases.
  5. `src/cli/forms/EntityForm.tsx` — sequential one-field-at-a-time Ink
     prompt (`ink-text-input`), skip-on-empty/no-default, accept-default-
     as-is, full answers map on completion, immediate `onDone({})` for an
     empty field list, 6 cases — all passed on first GREEN attempt.
  6. `src/cli/commands/newEntity.ts` — orchestration: id/name resolution
     (beat's positional is its `id` directly, no `name` field), flag values
     vs. remaining fields, dynamic `import("ink")`/`import(EntityForm)` so
     the interactive branch is never even loaded on the non-interactive
     path, 5 cases — all passed on first GREEN attempt.
  7. CLI wiring in `src/cli/index.ts` (excluded from coverage; verified
     manually: `new --help`, `new room --help`, and an end-to-end
     room/item/character/beat → validate → overwrite-refusal →
     id-collision-refusal run against a scratch copy of
     `examples/cave-of-echoes`).
  8. Docs: extended README's "Create an adventure" section with an "Add
     entities" subsection; added VERIFICATION_PLAN.md Scenario 7
     (non-interactive, flag-driven) and Scenario 8 (interactive Ink form,
     real TTY).
  9. Final pass (this entry).
- A follow-up test/GREEN cycle added an injectable `NewEntityDeps`
  (`promptFields`, `isTTY`) to `newEntity()`, mirroring `new.ts`'s existing
  `Prompter` injection pattern, so the interactive field-merging logic is
  unit-testable without a real TTY. `promptRemainingFields` itself (the Ink
  render glue) stays covered only by manual/e2e verification, the same
  accepted convention as `new.ts`'s `stdinPrompter`.
- Bug caught via manual end-to-end verification (not a regression in
  already-committed code, but in the verification plan I'd drafted before
  implementing): `VERIFICATION_PLAN.md` Scenario 7 originally had the item
  step skip both `--description` and `--location`, but `Item.description` is
  required by the schema (only `location` is optional) — so the scenario's
  own final `validate` step would have failed. Fixed by supplying
  `--description` and skipping only the schema-optional `--location`,
  consistent with beat's step already skipping only the optional `--trigger`.
- Tests: 282 passing, 0 failing (up from 269 pre-feature).
- Coverage: `slug.ts` 100/100/100/100. `entityWriter.ts` 97.31/88.57/100/97.31
  (one uncovered defensive fallback branch in `findEntityIdConflict`).
  `EntityForm.tsx` 100/100/100/100. `newEntity.ts` 71.21/87.5/50/71.21 — the
  uncovered lines are entirely `promptRemainingFields`'s Ink-rendering body,
  the same class of TTY-only glue `new.ts`'s `stdinPrompter` is exempted
  from. Overall repo: Stmts 90.41%, Branch 86.09%, Funcs 94.2%, Lines
  90.41% — meets the 90/85/90/90 thresholds.
- Build: Successful (`bun run build`), including a smoke run of the built
  `dist/cli/index.js` for `new --help`/`new room --help`.
- Linting: Clean (`bun run lint`), typecheck clean (`bun run typecheck`).
  (`bun run format:check` reports pre-existing repo-wide Prettier drift
  unrelated to this change, consistent with the prior PR's note about
  deliberately not running a blanket `prettier --write .`; not part of
  CLAUDE.md's required `bun run lint` gate.)
- End-to-end verification: ran the corrected Scenario 7 flow manually against
  a scratch copy of `examples/cave-of-echoes` — room/item/character/beat
  created, `validate` passes, re-running the same room command refuses to
  overwrite (file byte-for-byte unchanged), and `new room "Cavern"` refuses
  on the id collision with a message naming the existing room. Scenario 8
  (interactive Ink form over a real TTY) documented but not run in this
  non-interactive session — flagged for the developer to confirm.
- Completed: 2026-07-23
- Notes: merged `origin/main` mid-implementation (PR #19, the base `xyzzy
  new <name>` scaffold implementation) with no conflicts; it doesn't touch
  the `new` command's structure so Task 7's subcommand wiring applied
  cleanly on top. Held off on a version bump — this repo bumps version as
  its own separate commit once a feature is merged (see `#18` vs `#19` in
  the git log), and that's a decision for whoever merges this branch.

## Task: Code review fixes on entity subcommands (PR #20) - COMPLETE

- Started: 2026-07-23
- Scope: a manual code review of the entity-subcommands diff (no dedicated
  review skill was invokable in this session, so reviewed by hand) surfaced
  5 findings, verified by reproducing each before fixing. All 5 fixed with
  RED tests first.
- Finding 1 (security, path traversal): `entityFilePath` joined the
  caller-supplied id straight into a filesystem path with no validation,
  and beat's positional argument was used as the id with no `slugify` at
  all. `--id "../../escaped"` (or `new beat "../../escaped-beat"`) wrote
  files outside the adventure directory — reproduced on disk before the
  fix. Fixed by `assertValidId` in `entityWriter.ts`, rejecting any id
  containing `/`, `\`, or equal to `..`, before any fs access.
- Finding 2 (error handling): pointing `--adventure` at `adventure.yaml`
  itself (a form `resolveAdventureFile` already documents as valid input)
  crashed with a raw `ENOTDIR: not a directory, mkdir '.../adventure.yaml/rooms'`
  instead of a friendly message — the same bug class already fixed once for
  `scaffoldAdventure`'s `assertDirIsWritable`, reintroduced here. Fixed by
  `resolveAdventureDir`, normalizing to the containing directory via
  `resolveAdventureFile` + `dirname` before building any path.
- Finding 3 (correctness): an all-punctuation name (e.g. `"!!!"`) slugified
  to an empty string with no fallback, silently writing `<kind>/.yaml`.
  `scaffolder.ts`'s own local slugify already guards this exact case
  (`slug || "adventure"`); `util/slug.ts` didn't. Fixed by the same
  `assertValidId` as Finding 1 (empty-id check).
- Finding 4 (correctness): `EntityForm`'s empty-fields `onDone({})` guard
  depended on `[fields, onDone]`, so a re-render with fresh prop identities
  re-fired it — verified via a rerender test showing 3 calls instead of 1,
  violating the component's own "calls onDone once" contract. Not
  triggered by the current sole caller, but a latent bug for any future
  one. Fixed by switching to a true mount-once `useEffect(..., [])`.
- Finding 5 (correctness, minor): `writeEntityFile` checked
  `existsSync(path)` then wrote separately — a check-then-act race between
  two concurrent invocations targeting the same id. Not independently
  unit-testable (synchronous single-process code can't reproduce a
  multi-process race), so covered by the existing overwrite-refusal test
  continuing to pass. Fixed by using `writeFileSync(..., { flag: "wx" })`
  and catching `EEXIST` for the friendly message, closing the gap
  atomically at the OS level.
- Tests: RED confirmed for all findings with a concrete reproduction
  (findings 1/3/4 via new failing assertions; finding 2 via the file-path
  test genuinely crashing with the raw ENOTDIR before the fix). GREEN:
  287 tests passing (up from 282), 0 failing.
- Coverage: `entityWriter.ts` 96.4/88.88/100/96.4, `EntityForm.tsx`
  100/100/100/100. Overall repo: 90.47/86.38/94.24/90.47 (meets
  90/85/90/90).
- Build: Successful (`bun run build`). Linting: clean (`bun run lint`),
  typecheck clean (`bun run typecheck`).
- End-to-end verification: re-ran the three reproduction commands
  (`--id "../../escaped"`, `new room "!!!"`, `--adventure .../adventure.yaml`)
  against a scratch adventure — the first two now refuse cleanly with no
  file written, the third now succeeds and writes into the correct sibling
  directory instead of crashing.
- Completed: 2026-07-23
- Notes: a PR (#20) was opened for this branch from the Claude Code UI
  before this task started; no new PR was created, these commits update
  it directly.

## Task: Player-facing "Characters" footer (mirrors "Exits") - COMPLETE

- Started: 2026-07-27
- Scope: `runTurn` already appends an authoritative, programmatically
  computed "Exits" section to every turn's narration (`exitsFooter` in
  `src/engine/turnLoop.ts`). Added a parallel `charactersFooter` that lists
  the characters currently present in the player's room (by name, one per
  bullet), appended the same way — but omitted entirely (returns `null`)
  when nobody else is in the room, per the request, rather than printing a
  "none present" placeholder the way `exitsFooter` does for a real room
  with zero exits.
- Tests: RED — added a `charactersFooter` describe block to
  `src/engine/turnLoop.test.ts` (5 cases: lists present characters, null
  when room is empty, null for freeform/unset location, null for an
  improvised room not in the adventure, live per-character location
  override takes precedence over the authored starting location — reusing
  the same filter `digest.ts`/`detection.ts` already use) plus 2
  integration cases under the `runTurn` describe block (footer appended
  when characters are present; footer omitted when the room has none).
  Confirmed all 6 failed for the right reason (`charactersFooter is not a
  function` / narration missing the section). GREEN — implemented
  `charactersFooter` in `turnLoop.ts` and combined it with `exitsFooter`'s
  output in `runTurn` (joined by a blank line, each omitted independently
  when `null`). Full suite: 294 passing, 0 failing (up from 288).
- Coverage: new `charactersFooter` function fully covered (branches: room
  present/absent, characters present/absent, freeform location, live
  location override). Overall repo: Stmts 90.56%, Branch 86.52%, Funcs
  94.28%, Lines 90.56% — meets the 90/85/90/90 thresholds (pre-existing
  gaps in unrelated files/branches, e.g. `canonicalizeAction`'s untested
  switch arms, are unchanged by this diff).
- Build: Successful (`bun run build`)
- Linting: Clean (`bun run lint`)
- End-to-end verification: exercised via `FakeNarratorModel` in
  `runTurn` integration tests (no live model available in this session,
  consistent with `VERIFICATION_PLAN.md`'s note that turn-taking
  narration is out of scope without one). Confirmed `examples/cave-of-
  echoes` has a character (`grimble`, `location: lake`) that would
  exercise this path against a real model — flagged for the developer to
  spot-check via `bun run start -- play` if desired.
- Completed: 2026-07-27
- Notes: deliberately did not touch `buildSystemPrompt` or
  `stripProseExits` — unlike exits (which the model is told never to list,
  since the footer is the sole authoritative source and duplication would
  look like contradicting itself), narrating characters in prose is the
  expected/desired model behavior; this feature only adds the explicit,
  reliable roster alongside it, it doesn't suppress or replace character
  mentions in narration.

## `xyzzy dev` Multi-Pane Development TUI (Tasks 1-10) - COMPLETE

- Started: 2026-07-27
- Plan: `docs/plans/2026-07-27-dev-tool-tui-plan.md` (design:
  `docs/plans/2026-07-27-dev-tool-tui-design.md`)
- Tests: 339 passing, 0 failing (up from 287 at branch start; +52).
  Every task went RED first and was confirmed to fail for the intended
  reason before any production code was written.
  - Task 1 `entityCatalog.ts` — 8 tests (category order, labels, per-category
    entry listing, empty adventure)
  - Task 2 `renderFields.ts` — 12 tests (all four entity kinds + config,
    set/unset scalars, dispatch)
  - Task 3 `App.tsx` embeddability — 4 tests (`onQuit` override, default
    exit, inactive input, reactivation)
  - Tasks 4-7 `DevApp.tsx` — 28 tests (sidebar navigation, editing/reload/
    validation, play-focus mode, whole-tool quit)
- Coverage (new/changed files): `entityCatalog.ts` 100/86.66/100/100,
  `renderFields.ts` 100/100/100/100, `DevApp.tsx` 100/97.97/100/100.
  `App.tsx` branch coverage improved 77.67% -> 79.48% (the remaining
  shortfall against the 85% bar is pre-existing in untouched paths;
  measured against commit 32c5e7f to confirm). `dev.ts` is 0% by the same
  convention as `play.ts` (also 0%) — thin Ink/TTY orchestration glue with
  no test file, verified manually instead.
- Build: Successful (`bun run build`)
- Linting: Clean (`bun run lint`), typecheck clean (`bun run typecheck`)
- Completed: 2026-07-27
- Notes: Five defects in the plan were found and corrected during
  execution, four of them caught by the RED step:
  1. Plan's DevApp tests wrote to stdin immediately after mount, so Ink's
     `useInput` had not yet subscribed and the first keystroke of every
     test was dropped (7/10 Task 4 tests failed). Fixed with a `press()`
     helper carrying the same leading tick `App.test.tsx`'s `type()` uses.
  2. Escape and arrow-key literals had lost their `\x1b` prefix in the
     plan text (`stdin.write("")`, `stdin.write("[B")`).
  3. Task 6 asserted the seeded narration was the premise (`"A dark
     cave."`); `App.tsx` seeds from the start room's description, so the
     correct expectation is `"A dark cavern."`.
  4. `editSelected` called `readAdventureFile` unguarded inside a key
     handler; a YAML syntax error saved from `$EDITOR` would have thrown
     and torn down the whole TUI. Now caught and surfaced through the same
     inline banner, with a regression test.
  5. `Escape` left the play submenu open while moving focus away. It now
     closes the submenu too.
- Outstanding: `VERIFICATION_PLAN.md` Scenario 9 requires a real TTY and
  has NOT been run — it needs to be driven manually by the developer.

## `xyzzy dev` — Post-verification bug fixes - COMPLETE

- Started: 2026-07-27 (after developer ran VERIFICATION_PLAN Scenario 9)
- Reported symptom: pressing `e` did not open the selected file in the editor.
- Root cause (found via systematic-debugging, not the initially guessed
  relative-vs-absolute path — the path was absolute): `entityFilePath` builds
  `<kind>s/<id>.yaml`, which is the *creation* convention `xyzzy new` writes
  to, not a lookup of where an entity is actually defined. Adventures may
  define entities inline in `adventure.yaml`, or put several in one file under
  an unrelated name — `examples/cave-of-echoes` does both (`rooms/cave.yaml`
  holds `entrance` + `cavern`; `items/items.yaml` holds four items). Measured:
  8 of that example's 12 entities resolved to files that do not exist,
  including the first room, so the editor opened an empty buffer.
- Why the unit tests missed it: the `tmpAdventure()` fixture wrote one entity
  per file with filename == id, encoding the same wrong assumption as the
  code. Fixtures now mirror the real multi-entity layout, and new loader tests
  assert provenance against `examples/cave-of-echoes` itself.
- Fix 1 (`loader.ts`, `DevApp.tsx`): the loader already tracked
  `SourcedValue.file` for duplicate-id errors and discarded it; surfaced as
  `EntitySourceMap` via `readAdventureFileWithSources`, and edit targets now
  resolve through it. Verified all 12 example entities resolve to existing
  files (was 4).
- Fix 2 (`util/editor.ts`, new): `defaultOpenEditor` had four defects —
  inverted VISUAL/EDITOR precedence, `??` treating `EDITOR=""` as set, no
  argument parsing (so `EDITOR="code --wait"` spawned a binary literally named
  `code --wait`), and a discarded `spawnSync` result making a failed launch
  silent. GUI editors return immediately without their wait flag, so the
  reload fired before any edit. Launch failures now report in the inline
  banner rather than throwing out of the key handler and killing the TUI.
- Tests: 356 passing, 0 failing (up from 344). Both fixes went RED first, each
  reproducing the real-world layout/condition before any production change.
- Build: Successful. Linting: clean. Typecheck: clean.
- Completed: 2026-07-27
- Developer confirmed the fix against Scenario 9 in a real terminal.
- Known limitation (not fixed): Ink holds stdin in raw mode with its own
  `readable` listener, and the editor spawn does not release it, so terminal
  editors (vim/nano, and the `vi` fallback) may misbehave. GUI editors are
  unaffected. Deferred rather than shipped unverified — it needs a TTY to
  validate and involves Ink's `setRawMode` refcounting.

## Move saves to `$XDG_STATE_HOME/xyzzy/<adventure id>/saves/` - COMPLETE

- Started: 2026-07-28
- Goal: saves were `<adventureDir>/saves/`, tied to wherever the adventure
  happened to live. Moved them to a global, XDG-standard location keyed by
  the adventure's `meta.id`, mirroring `util/log.ts`'s existing
  `XDG_STATE_HOME` pattern, so saves survive moving/reinstalling the
  adventure directory itself.
- `engine/save.ts`: `savesDir`/`savePath`/`saveExists`/`listSaves`/
  `saveGame`/`loadGame` now take an adventure id instead of a directory,
  resolving to `$XDG_STATE_HOME/xyzzy/<slugified id>/saves` (default
  `~/.local/state/xyzzy/<id>/saves`). The id is run through the existing
  `util/slug.ts` `slugify` before use — `meta.id` is unrestricted,
  untrusted `adventure.yaml` content, and building a path with it directly
  would let a crafted id like `../../etc` escape the saves tree. Tests
  cover the round trip, corrupt/missing/schema-invalid saves, the global
  path shape, the XDG fallback, and the traversal-sanitization case.
- `tui/App.tsx`: dropped the `adventureDir` prop (it was only ever used to
  build save paths); `/save`, `/load`, and the post-turn autosave now key
  off `adventure.meta.id`, which was already available via the `adventure`
  prop. Backfilled a `/save` test — it turned out the slash command itself
  had no test even before this change (only `/load` did), and since I
  edited that exact line I added coverage for it rather than leave a
  touched-but-unverified path.
- `tui/DevApp.tsx`: its `listSaves`/`loadGame` calls (for the `p` play/
  resume submenu) switched to `adventure.meta.id`; stopped passing the
  now-removed `adventureDir` prop to the embedded `App`.
- `cli/commands/play.ts`: `saveExists`/`loadGame` switched to
  `adventure.meta.id`; stopped passing `adventureDir` to `App`. No
  dedicated test file for `play.ts` (pre-existing convention, like
  `index.ts`/`dev.ts`) — covered by VERIFICATION_PLAN Scenario 5.
- `world/scaffolder.ts`: no longer creates a `saves/` dir or mentions it in
  the scaffolded README, since saves are no longer part of the adventure
  directory. `scaffolder.test.ts`'s "creates a saves/ directory" test was
  flipped to assert the opposite (RED against the unchanged scaffolder,
  then GREEN after removing the `mkdirSync`).
- Docs: `README.md` (scaffold description, new saves-path note under
  `/save`/`/load`) and `VERIFICATION_PLAN.md` (Scenario 1 no longer expects
  a local `saves/` dir; Scenario 5 scopes `XDG_STATE_HOME` to a scratch dir,
  mirroring how Scenario 4 already scopes `XDG_CONFIG_HOME`, and checks
  saves under the new global path).
- Tests: 456 passing, 0 failing (up from 455 — one test file rewritten,
  one new `/save` test added).
- Coverage: Stmts 92.25%, Branch 89.17%, Funcs 95.72%, Lines 92.25%
  (aggregate; `vitest.config.ts` has no per-file thresholds configured).
  `engine/save.ts` itself is 100% covered on all four metrics.
- Build: ✅ Successful (`bun run build`, zero errors).
- Linting: ✅ Clean (`eslint .`, zero errors/warnings).
- Typecheck: ✅ Clean (`tsc --noEmit`).
- Completed: 2026-07-28

## Fix: empty-slug save collision - COMPLETE

- Started: 2026-07-28
- Goal: code review of the above flagged that `slugify(adventureId)` can
  return `""` for an id made entirely of characters the slug regex strips
  (e.g. `"..."` or `"!!!"`). `path.join` silently drops that empty segment,
  so `savesDir` collapsed to the shared `xyzzy/saves` bucket instead of a
  per-adventure path — any two adventures whose ids both reduced to empty
  would silently overwrite each other's saves, undermining the isolation
  the `slugify` call exists to provide.
- `engine/save.test.ts`: RED — added
  `"keeps ids that slugify to an empty string distinct from each other"`,
  asserting `savePath("...", "autosave")` and `savePath("!!!", "autosave")`
  resolve to different, traversal-free paths. Confirmed it failed
  (`Object.is` equality) against the unfixed `savesDir`.
- `engine/save.ts`: GREEN — `savesDir` now falls back to a hex encoding of
  the raw id (`Buffer.from(adventureId, "utf8").toString("hex")`) whenever
  `slugify` returns an empty string, preserving per-adventure uniqueness
  while keeping the path traversal-free.
- Tests: 457 passing, 0 failing (up from 456 — one new test added).
- Coverage: `engine/save.ts` remains 100% on all four metrics; aggregate
  unchanged at 92.26%/89.18%/95.72%/92.26%.
- Build: ✅ Successful (`bun run build`, zero errors).
- Linting: ✅ Clean (`eslint .`, zero errors/warnings).
- Completed: 2026-07-28

## LLM Debugging View (docs/plans/2026-07-28-llm-debug-log-plan.md) - COMPLETE

- Started: 2026-07-28
- Goal: persist every detector/narrator LLM call made during a play session to
  a per-session JSONL file, and add a read-only "LLM Logs" category to the
  `xyzzy dev` sidebar for browsing them. Executed as 13 plan tasks, each its
  own RED-GREEN-commit cycle.

### Tasks

- **1-5 · `llm/sessionLog.ts`** (19 tests): `sessionLogPath` mirroring
  `engine/save.ts`'s `savesDir` (same slugify + hex fallback, under `logs/`
  rather than `saves/`); `SessionRecorder` decorating a `NarratorModel`/
  `Detector` to buffer each call's context, result and duration, recording
  failures before rethrowing; `startSessionLog` writing the header line
  immediately and appending one JSONL turn record per turn, best-effort like
  `util/log.ts`; `listSessionLogs` (tolerant — a corrupt header falls back to
  the filename) and `readSessionLog` (strict — names the bad line, so the TUI
  can banner it).
- **6 · `tui/dev/renderSessionLog.ts`** (7 tests): `renderSessionLogFields`
  turning parsed records into the existing `FieldRow` shapes, so the current
  `layoutFieldRows` → `ContentLine` pipeline renders logs with no new UI code.
- **7-8 · catalog + hotkeys**: `"logs"` added to the `Category` union,
  `CATEGORIES` and `CATEGORY_LABELS`; `isLogsCategory` on `HotKeyContext`
  gating the Edit key, since logs are read-only.
- **9 · `tui/App.tsx`** (5 new tests): optional `sessionLog` prop; model and
  detector wrapped at every build site (so a mid-session `/model` or
  `/provider` switch keeps recording), flushed and appended after each turn on
  both the success and failure paths.
- **10 · `tui/DevApp.tsx`** (9 new tests): `startPlay` mints a handle and
  refreshes the listing; sidebar rows unified across entities and log files;
  `entryCount`/`fieldRows`/`logContent` branch on the logs category; unreadable
  logs banner inline.
- **11 · `xyzzy play --log-llm`**: opt-in recording for standalone play
  (`dev` always records). Verified manually per the plan — help text lists the
  flag; with it a session file is written holding a single `type:"session"`
  header line; without it no `logs/` directory is created at all.
- **12 · docs**: README "LLM Logs" section and the `--log-llm` flag;
  VERIFICATION_PLAN.md Scenarios 10 and 11, both exercisable with no reachable
  model (a failed narrator call is exactly what makes the view useful).

### Design decision taken during execution

The plan's Task 10 test and its draft Scenario 10 both assumed the content pane
would show a selected log while a play session was still live. It does not: a
live session owns the content pane for every category (`DevApp.tsx`), and
changing that would either unmount the session — losing the scrollback that
`p`-to-resume depends on — or require hiding it behind `display="none"`.
Confirmed with the developer and kept the existing precedence, so a session's
own log is read after `/quit`-ing it; the sidebar lists it either way. Both the
test and the shipped Scenario 10 reflect this.

### Verification

- Tests: 503 passing, 0 failing (up from 469; +34).
- Coverage (thresholds 90/85/90/90 — lines/branches/functions/statements):
  - `llm/sessionLog.ts` — 99.32 / 91.17 / 100 / 99.32
  - `tui/dev/renderSessionLog.ts` — 100 / 100 / 100 / 100
  - `tui/DevApp.tsx` — 99.76 / 95.67 / 100 / 99.76
  - `tui/dev/hotkeys.ts` — 100 / 100 / 100 / 100
  - `tui/dev/entityCatalog.ts` — 100 / 87.5 / 100 / 100
  - `tui/App.tsx` — 94.24 / 82.7 / 100 / 94.24. Branch coverage sits below the
    85% bar, but it was 80.83% on `origin/main` before this work and this
    branch raises it; the untested branches are pre-existing `/model list`
    error paths, not anything added here.
  - Aggregate — 92.48 / 89.59 / 96.19 / 92.48.
  - `cli/commands/play.ts` stays at 0%, matching `dev.ts`/`validate.ts`: CLI
    wiring is verified manually by convention, not unit-tested.
- Build: ✅ Successful (`bun run build`, zero errors).
- Linting: ✅ Clean (`eslint .`, zero errors/warnings).
- Typecheck: ✅ Clean (`tsc --noEmit`).
- Note: one pre-existing DevApp test ("does not grow past the terminal height
  as the transcript accumulates") intermittently exceeds its 5s limit under
  coverage instrumentation when all 42 files run in parallel. It passes in
  isolation under coverage on both this branch and `origin/main`, and a repeat
  full run was green — contention, not a regression.
- Completed: 2026-07-28
