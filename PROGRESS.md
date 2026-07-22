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
