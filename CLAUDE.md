## Project Overview

**xyzzy**: A toolkit for building and playing text adventures with local LLMs.

### Problem

Existing AI-narrated interactive fiction tools either rely on raw chat history (which drifts and doesn't survive long games) or send your game data to a cloud provider. Authors want a lightweight way to describe a world — from a one-paragraph premise to a fully mapped set of rooms, items, and characters — and have it stay coherent and playable entirely on a local model.

### Approach

An adventure is authored as YAML content describing the world. Playing it creates a schema-validated game state (location, inventory, flags, per-character data) that a turn loop keeps in sync: the model narrates and emits typed tool-call actions, which are validated and folded into state through a pure reducer, then autosaved. State lives outside the chat history, so games are saveable, resumable, and testable independent of context window limits.

## Tech Stack

- **Language**: TypeScript (ESM), Node.js >=20
- **Deployment target**: CLI tool (`xyzzy` bin), published to npm as `@britt/xyzzy`, runs entirely on the user's machine
- **Package Manager**: bun (bun.lock)
- **Testing**: Vitest
- **Linting**: ESLint + Prettier
- **Build**: `bun build` (bundles CLI/library entry points) + `tsc` (type declarations), via `tsconfig.build.json`
- **Key Libraries**: Ink (terminal UI), Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`) for model calls and tool-use, zod (schemas/validation), commander (CLI), yaml (adventure authoring format)

## Git Practices

- **Branching strategy**: Feature branches off `main`. Conductor manages worktree isolation per workspace, so no manual worktree setup is needed.
- **Branch naming**: `<prefix>/<short-kebab-case-description>`
  - `feature/` — new features
  - `fix/` — bug fixes
  - `chore/` — maintenance, tooling, dependency bumps, docs-only changes

# Rules for Claude

## ABSOLUTE RULES - NO EXCEPTIONS

### 1. Test-Driven Development is MANDATORY

**The Iron Law**: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST

Every single line of production code MUST follow this cycle:
1. **RED**: Write failing test FIRST
2. **Verify RED**: Run test, watch it fail for the RIGHT reason
3. **GREEN**: Write MINIMAL code to pass the test
4. **Verify GREEN**: Run test, confirm it passes
5. **REFACTOR**: Clean up with tests staying green

### 2. Violations = Delete and Start Over

If ANY of these occur, you MUST delete the code and start over:
- ❌ Wrote production code before test → DELETE CODE, START OVER
- ❌ Test passed immediately → TEST IS WRONG, FIX TEST FIRST
- ❌ Can't explain why test failed → NOT TDD, START OVER
- ❌ "I'll add tests later" → DELETE CODE NOW
- ❌ "Just this once without tests" → NO. DELETE CODE.
- ❌ "It's too simple to test" → NO. TEST FIRST.
- ❌ "Tests after achieve same goal" → NO. DELETE CODE.

### 3. Test Coverage Requirements

- **Minimum 90%** coverage on ALL metrics:
  - Lines: 90%+
  - Functions: 90%+
  - Branches: 85%+
  - Statements: 90%+
- Coverage below threshold = Implementation incomplete
- Untested code = Code that shouldn't exist

### 4. Implementation Order

Follow the plan tasks listed in @IMPLEMENTATION_PLAN.md in EXACT order.

### 5. Before Writing ANY Code

Ask yourself:
1. Did I write a failing test for this?
2. Did I run the test and see it fail?
3. Did it fail for the expected reason?

If ANY answer is "no" → STOP. Write the test first.

### 6. Test File Structure

For every production file, there MUST be a co-located test file:
- `src/example.ts` → `src/example.test.ts`
- `src/engine/save.ts` → `src/engine/save.test.ts`
- `src/tui/App.tsx` → `src/tui/App.test.tsx`

### 7. Task Completion Requirements

**MANDATORY RULE**: NO TASK IS COMPLETE until:
- ✅ ALL tests pass (100% green)
- ✅ Build succeeds with ZERO errors
- ✅ NO linter errors or warnings
- ✅ Coverage meets minimum thresholds (90%+)
- ✅ Progress documented in PROGRESS.md

A task with failing tests, build errors, or linter warnings is INCOMPLETE. Period.

### 8. Progress Documentation

**MANDATORY RULE**: YOU MUST REPORT YOUR PROGRESS IN `PROGRESS.md`

After completing EACH task:
1. Create `PROGRESS.md` if it doesn't exist
2. Document:
   - Task completed
   - Tests written/passed
   - Coverage achieved
   - Any issues encountered
   - Timestamp

Format:
```markdown
## Task X: [Name] - [COMPLETE/IN PROGRESS]
- Started: [timestamp]
- Tests: X passing, 0 failing
- Coverage: Lines: X%, Functions: X%, Branches: X%, Statements: X%
- Build: ✅ Successful / ❌ Failed
- Linting: ✅ Clean / ❌ X errors
- Completed: [timestamp]
- Notes: [any relevant notes]
```

### 9. Git Commits - Commit Early, Commit Often

**MANDATORY RULE**: COMMIT EARLY, COMMIT OFTEN

- **Commit after EACH successful TDD cycle**:
  - ✅ After RED-GREEN-REFACTOR cycle completes
  - ✅ After each test file is created
  - ✅ After each module implementation
  - ✅ After fixing bugs or issues
  - ✅ After updating documentation

- **Frequency Requirements**:
  - Minimum: After each completed subtask
  - Maximum: No more than 30 minutes without a commit
  - Never have more than one feature in a single commit

- **Each commit MUST**:
  - Have failing tests written first
  - Pass all tests
  - Build successfully
  - Have no linter errors
  - Meet coverage requirements (if code was added)
  - Have progress documented
  - Include clear commit message mentioning TDD

- **Commit Message Format**:
  ```
  type(scope): brief description

  - RED: What tests were written first
  - GREEN: What minimal code was added
  - Status: X tests passing, build successful
  - Coverage: X% (if applicable)
  ```

- **Benefits of Frequent Commits**:
  - Easy rollback if something breaks
  - Clear history of TDD progression
  - Smaller, reviewable changes
  - Proof of TDD discipline

## Development Workflow

For EACH feature/function:

```
1. Write test file or add test case
2. Run: bun run test
3. See RED (test fails)
4. Understand WHY it fails
5. Write minimal production code
6. Run: bun run test
7. See GREEN (test passes)
8. Refactor if needed
9. Run: bun run test (stays green)
10. Check coverage: bun run vitest run --coverage
11. Repeat for next feature
```

## Commands You'll Use Constantly

```bash
# Watch mode - keep this running ALWAYS
bun run test:watch

# Run once
bun run test

# Check coverage
bun run vitest run --coverage

# Build - MUST succeed before task is complete
bun run build

# Check for Linter errors
bun run lint
```

## Red Flags - STOP Immediately

If you catch yourself:
- Opening a code file before a test file
- Writing function implementation before test
- Thinking "I know this works"
- Copying code from examples without tests
- Skipping test runs
- Ignoring failing tests
- Writing multiple features before testing

**STOP. DELETE. START WITH TEST.**

## The Mindset

- Tests are not optional
- Tests are not added after
- Tests DRIVE the implementation
- If it's not tested, it doesn't exist
- Coverage below 90% = unfinished work

## Accountability Check

Before marking ANY task complete, verify:
1. ✓ Test written first?
2. ✓ Test failed first?
3. ✓ Minimal code to pass?
4. ✓ All tests green?
5. ✓ Coverage maintained (90%+)?
6. ✓ Build succeeds (`bun run build`)?
7. ✓ No linter errors?
8. ✓ Progress documented in PROGRESS.md?

Missing ANY ✓ = Task is NOT complete. Fix it first.

## Final Rule

**When in doubt**: Write a test.
**When not in doubt**: Write a test anyway.
**When it seems too simple**: Especially write a test.

There are NO exceptions to TDD in this project. None.

---

*This document is your contract. Breaking these rules means breaking the project's core quality commitment. The discipline of TDD is what separates professional, reliable code from hopeful guesswork.*

## Git Commit Rules

**COMMIT EARLY, COMMIT OFTEN** - This is mandatory.

- Commit after every successful TDD cycle (RED-GREEN-REFACTOR)
- Commit after completing any discrete unit of work
- Commit before switching context or taking breaks
- Never have more than 30 minutes of uncommitted work
- Each commit should be atomic: one logical change per commit

Why this matters:
- Small commits are easier to review and revert
- Frequent commits prevent loss of work
- Atomic commits make git history useful for debugging
- Regular commits force you to think in small, testable increments

## Pull Request Rules

YOU MUST follow these rules when creating a pull request.

- Use a merge commit, do not squash commits.
- If you are working on an issue, make sure to note in the PR description that this PR closes the issue number.
