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
