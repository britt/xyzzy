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
