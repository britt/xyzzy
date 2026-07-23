# Verification Plan

**Verification runs automatically after completing any task. Do not wait for the developer to request it.**

These scenarios assume **no local LLM server is available**. They cover every CLI/TUI flow that doesn't require a live model — turn-taking (narration) is out of scope until a model-backed scenario is added separately.

## Prerequisites

- `bun install` has been run (dependencies present in `node_modules`).
- Commands are run from the repo root via `bun run start -- <args>`. Note this is **not** equivalent to the published `xyzzy` binary — `bun run start` runs `src/cli/index.ts` directly, while the published binary is invoked through npm's symlinked `bin` entry pointing at the built `dist/cli/index.js`. Scenario 6 exercises that packaged path specifically; a bug that only manifests through a symlinked entry point (as in the incident that added Scenario 6) will not show up in Scenarios 1-5.
- The real example adventure at `examples/cave-of-echoes` is present and untouched — copy it to a scratch directory (e.g. under `/tmp`) rather than editing it in place or writing saves into it.
- A scratch directory for throwaway output (adventures, configs, saves), cleaned up after each scenario.
- Scenario 5 additionally requires a real interactive terminal (TTY), since Ink's input handling needs one.
- Scenario 8 also requires a real TTY, for the same reason.

## Scenarios

### Scenario 1: Scaffold a new adventure (`xyzzy new`)

**Context**: `src/cli/commands/new.ts` is currently a stub (`notImplemented()`), so this scenario is expected to FAIL until it's implemented. It documents the intended behavior from the README so the gap is caught the moment someone assumes it works.

**Steps**:
1. `bun run start -- new /tmp/xyzzy-verify-new`

**Success Criteria**:
- [ ] Command exits 0
- [ ] `/tmp/xyzzy-verify-new/adventure.yaml` exists and is a minimal valid adventure
- [ ] `/tmp/xyzzy-verify-new/saves/` exists
- [ ] A README and commented example room/character are present in the scaffold

**If Blocked**: Expected to fail today (`notImplemented` error). Record it as a known gap, not a regression — do not attempt to implement `new` as part of running verification.

### Scenario 2: Validate a valid adventure

**Context**: `examples/cave-of-echoes` is a real, checked-in adventure that should always validate cleanly.

**Steps**:
1. `bun run start -- validate examples/cave-of-echoes`

**Success Criteria**:
- [ ] Command exits 0
- [ ] stdout contains `✓ examples/cave-of-echoes/adventure.yaml is valid` (path may vary slightly)

**If Blocked**: If this fails, treat it as a real regression (the example adventure is part of the repo's contract) and stop to investigate rather than editing the example to make it pass.

### Scenario 3: Validate an invalid adventure

**Context**: Confirms `validate` catches and precisely reports cross-reference errors (e.g. an exit pointing to a room that doesn't exist).

**Steps**:
1. Copy `examples/cave-of-echoes` to `/tmp/xyzzy-verify-invalid`.
2. Edit `/tmp/xyzzy-verify-invalid/rooms/cave.yaml` to add an exit pointing to a nonexistent room id (e.g. `exits: { down: "nowhere" }`).
3. `bun run start -- validate /tmp/xyzzy-verify-invalid`
4. Delete `/tmp/xyzzy-verify-invalid`.

**Success Criteria**:
- [ ] Command exits non-zero
- [ ] stderr reports the issue count and the exact path, e.g. `entities.rooms[...].exits.down → unknown room "nowhere"`

**If Blocked**: If the error path/message is vague or missing, that's a real bug in `validator.ts` — report it, don't paper over it.

### Scenario 4: Provider config lifecycle (isolated config)

**Context**: `xyzzy config` reads/writes `$XDG_CONFIG_HOME/xyzzy/config.json`, so this scenario points `XDG_CONFIG_HOME` at a scratch directory to avoid touching the developer's real global config.

**Steps**:
1. `export XYZZY_CFG=$(mktemp -d)`
2. `XDG_CONFIG_HOME=$XYZZY_CFG bun run start -- config add local --model llama3.1 --base-url http://localhost:11434/v1`
3. `XDG_CONFIG_HOME=$XYZZY_CFG bun run start -- config list`
4. `XDG_CONFIG_HOME=$XYZZY_CFG bun run start -- config add cloud --model gpt-4o --kind openai --api-key-env OPENAI_API_KEY`
5. `XDG_CONFIG_HOME=$XYZZY_CFG bun run start -- config use cloud`
6. `XDG_CONFIG_HOME=$XYZZY_CFG bun run start -- config list`
7. `rm -rf $XYZZY_CFG`

**Success Criteria**:
- [ ] Step 2 prints `Added provider "local": ...` and `Set "local" as the default provider.` (first provider added)
- [ ] Step 3 lists `* local  ...`
- [ ] Step 4 adds `cloud` without changing the default
- [ ] Step 5 prints `Default provider is now "cloud".`
- [ ] Step 6 lists `* cloud` and `  local`
- [ ] `$XYZZY_CFG/xyzzy/config.json` contains both providers with `"default": "cloud"`
- [ ] The developer's real `~/.config/xyzzy/config.json` is untouched throughout

**If Blocked**: If a real global config already exists and this scenario is ever run without the `XDG_CONFIG_HOME` override, stop immediately — do not let verification mutate the developer's real provider config.

### Scenario 5: Save/load cycle via the real TUI (`/save`, `/load`, `/load list`, `/quit`)

**Context**: Meta commands are intercepted before any model call (see `src/tui/App.tsx`), so `/save`, `/load`, and `/load list` are fully exercisable without a live model. This must run in a real interactive terminal — Ink requires TTY raw-mode input.

**Steps**:
1. Copy `examples/cave-of-echoes` to `/tmp/xyzzy-verify-play`.
2. In a real terminal: `bun run start -- play /tmp/xyzzy-verify-play`
3. Type `/save` and press Enter.
4. Type `/save my-slot` and press Enter.
5. Type `/load list` and press Enter.
6. Type `/load` (no argument) and press Enter.
7. Type `/load my-slot` and press Enter.
8. Type `/quit` and press Enter.
9. Delete `/tmp/xyzzy-verify-play`.

**Success Criteria**:
- [ ] Step 3 prints `Saved to slot "autosave".` and `/tmp/xyzzy-verify-play/saves/autosave.json` exists and is valid JSON matching the game-state schema
- [ ] Step 4 prints `Saved to slot "my-slot".` and `saves/my-slot.json` exists
- [ ] Step 5 prints `Known saves:` listing both `autosave` and `my-slot`
- [ ] Step 6 (bare `/load`) prints the same listing as step 5
- [ ] Step 7 prints `Loaded slot "my-slot".`
- [ ] No error banners appear at any point, despite no live model being reachable
- [ ] Step 8 exits the TUI cleanly back to the shell

**If Blocked**: If no real TTY is available (e.g. a non-interactive sandboxed tool), stop and ask the developer to run this scenario, or note the limitation explicitly in the verification log. Do not substitute `ink-testing-library` and report it as this scenario passing — that's a unit test, not verification.

### Scenario 6: Packaged global install actually executes (`npm pack` + `npm install -g`)

**Context**: The published CLI is invoked through npm's `bin` symlink (`<prefix>/bin/xyzzy` → `<prefix>/lib/node_modules/@britt/xyzzy/dist/cli/index.js`), not by running the file directly. An entry-point self-invocation check that compares `import.meta.url` against an unresolved `process.argv[1]` (or any other logic sensitive to symlink vs. realpath) can pass every unit test and every `bun run start` check while still making the installed binary silently no-op — no error, no output, exit 0 — because none of those paths go through a symlink. This scenario is the only one in this plan that does.

**Steps**:
1. `bun run build`
2. `mkdir -p /tmp/xyzzy-verify-pack/prefix && cd /tmp/xyzzy-verify-pack`
3. `npm pack <repo-root>` (produces `britt-xyzzy-<version>.tgz`)
4. `npm install -g --prefix ./prefix ./britt-xyzzy-<version>.tgz`
5. `./prefix/bin/xyzzy --help`
6. `./prefix/bin/xyzzy validate <repo-root>/examples/cave-of-echoes`
7. `rm -rf /tmp/xyzzy-verify-pack`

**Success Criteria**:
- [ ] Step 5 prints the commander-generated usage/help text (not a silent, empty, exit-0 no-op)
- [ ] Step 6 prints `✓ .../adventure.yaml is valid` and exits 0
- [ ] Neither step exits 0 with zero stdout/stderr

**If Blocked**: If this fails, it's a real regression in how the CLI's entry point resolves its own invocation — do not paper over it by only checking `bun run start` or unit tests; both can stay green while this is broken.

### Scenario 7: Non-interactive entity creation (`xyzzy new room|item|character|beat`)

**Context**: `src/cli/commands/newEntity.ts` and its CLI wiring in `src/cli/index.ts` don't exist yet (see `IMPLEMENTATION_PLAN.md`), so this scenario is expected to FAIL until Tasks 1–7 are implemented. It exercises the flag-driven, non-interactive path — no TTY required — including the placeholder-comment behavior, id-collision refusal, and overwrite refusal, and confirms the written files integrate cleanly with `validate`.

**Steps**:
1. Copy `examples/cave-of-echoes` to `/tmp/xyzzy-verify-entities`.
2. `bun run start -- new room "Old Cistern" --adventure /tmp/xyzzy-verify-entities --description "A dank stone cistern, long since run dry." --non-interactive`
3. `bun run start -- new item "Rusted Key" --adventure /tmp/xyzzy-verify-entities --non-interactive` (no `--description`/`--location`)
4. `bun run start -- new character "Old Hermit" --adventure /tmp/xyzzy-verify-entities --persona "A reclusive hermit who trusts no one." --location cavern --non-interactive`
5. `bun run start -- new beat won-the-key --adventure /tmp/xyzzy-verify-entities --description "The player receives the rusted key." --non-interactive`
6. Re-run step 2 verbatim a second time.
7. `bun run start -- new room "Cavern" --adventure /tmp/xyzzy-verify-entities --non-interactive` (slugifies to `cavern`, which already exists as a room id in `cave-of-echoes`)
8. `bun run start -- validate /tmp/xyzzy-verify-entities`
9. Delete `/tmp/xyzzy-verify-entities`.

**Success Criteria**:
- [ ] Step 2 exits 0, prints a confirmation naming `rooms/old-cistern.yaml`, and that file contains `id: old-cistern`, `name: Old Cistern`, an uncommented `description:` line with the supplied text, and a commented `# exits:` placeholder block
- [ ] Step 3 exits 0 and `items/rusted-key.yaml` has `id`/`name` set plainly but both `# description: <placeholder>` and `# location: <placeholder>` commented out
- [ ] Step 4 exits 0 and `characters/old-hermit.yaml` has `persona` and `location: cavern` set plainly, with `# history: []`, `# state: {}`, and `# beats:` placeholders present
- [ ] Step 5 exits 0 and `beats/won-the-key.yaml` has `id: won-the-key` (no `name` field at all), an uncommented `description:`, and a commented `# trigger:` and `# effects:` block
- [ ] None of steps 2–5 hang or attempt to open a TTY/render the Ink form — they return promptly
- [ ] Step 6 exits non-zero, reports the file already exists, and leaves `rooms/old-cistern.yaml` byte-for-byte unchanged
- [ ] Step 7 exits non-zero, reports the id `cavern` conflict (naming where it's already defined), and writes no file
- [ ] Step 8 exits 0 and reports the adventure valid — confirming the new files (including `old-hermit`'s reference to the existing `cavern` room) merge cleanly through the loader's conventional-directory scan without breaking cross-reference validation

**If Blocked**: Expected to fail today (the subcommands don't exist). Once implemented, if any step is vague or silently no-ops, treat it as a real bug in `entityWriter.ts`/`newEntity.ts` — report it, don't paper over it.

### Scenario 8: Interactive entity creation via the real Ink form

**Context**: Extends Scenario 7 to the interactive path — `EntityForm` (`src/cli/forms/EntityForm.tsx`) only runs when stdin is a real TTY and `--non-interactive` wasn't passed, the same constraint Scenario 5 documents for the play TUI. This must run in a real interactive terminal.

**Steps**:
1. Copy `examples/cave-of-echoes` to `/tmp/xyzzy-verify-entity-form`.
2. In a real terminal: `bun run start -- new item "Brass Whistle" --adventure /tmp/xyzzy-verify-entity-form`
3. At the `Description` prompt, type a description and press Enter.
4. At the `Location` prompt, press Enter with no input (skip).
5. `cat /tmp/xyzzy-verify-entity-form/items/brass-whistle.yaml`
6. In the same terminal: `bun run start -- new item "Tin Whistle" --adventure /tmp/xyzzy-verify-entity-form --description "A cheap tin whistle." --location cavern`
7. Delete `/tmp/xyzzy-verify-entity-form`.

**Success Criteria**:
- [ ] Step 2 launches and shows a `Description` prompt (only unset scalar fields are prompted; `id`/`name` are already resolved from the positional argument and never themselves prompted)
- [ ] Step 3's typed value appears uncommented as `description:` in the written file
- [ ] Step 4's skip appears as a commented `# location: <placeholder>` line in the written file
- [ ] No error banners appear at any point, and the process exits cleanly back to the shell once the file is written
- [ ] Step 6, with both relevant flags supplied up front, writes `items/tin-whistle.yaml` immediately with no form shown at all (both scalar fields already satisfied by flags)

**If Blocked**: If no real TTY is available (e.g. a non-interactive sandboxed tool), stop and ask the developer to run this scenario, or note the limitation explicitly in the verification log. Do not substitute `ink-testing-library` and report it as this scenario passing — that's a unit test, not verification.

## Verification Rules

- Never use mocks or fakes
- Test environments must be fully running copies of real systems
- Scratch directories (`/tmp/xyzzy-verify-*`, temp `XDG_CONFIG_HOME`) are always cleaned up after each scenario, and never point at the developer's real config or the checked-in `examples/` directory
- If any success criterion fails, verification fails
- Ask developer for help if blocked, don't guess
