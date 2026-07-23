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
