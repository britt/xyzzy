# Verification Plan

**Verification runs automatically after completing any task. Do not wait for the developer to request it.**

These scenarios assume **no local LLM server is available**. They cover every CLI/TUI flow that doesn't require a live model — turn-taking (narration) is out of scope until a model-backed scenario is added separately.

## Prerequisites

- `bun install` has been run (dependencies present in `node_modules`).
- Commands are run from the repo root via `bun run start -- <args>`. Note this is **not** equivalent to the published `xyzzy` binary — `bun run start` runs `src/cli/index.ts` directly, while the published binary is invoked through npm's symlinked `bin` entry pointing at the built `dist/cli/index.js`. Scenario 6 exercises that packaged path specifically; a bug that only manifests through a symlinked entry point (as in the incident that added Scenario 6) will not show up in Scenarios 1-5.
- The real example adventure at `examples/cave-of-echoes` is present and untouched — copy it to a scratch directory (e.g. under `/tmp`) rather than editing it in place or writing saves into it.
- A scratch directory for throwaway output (adventures, configs, saves), cleaned up after each scenario.
- Scenario 5 additionally requires a real interactive terminal (TTY), since Ink's input handling needs one.

## Scenarios

### Scenario 1: Scaffold a new adventure (`xyzzy new`)

**Context**: `new` prompts interactively for the game's title (defaults to the target directory's name) and an optional premise (defaults to a placeholder when skipped), then scaffolds the adventure. The prompts work over piped stdin as well as a real TTY, so this scenario can run non-interactively.

**Steps**:
1. `printf 'Verify Adventure\nA premise for verification.\n' | bun run start -- new /tmp/xyzzy-verify-new`
2. `bun run start -- validate /tmp/xyzzy-verify-new`
3. Delete `/tmp/xyzzy-verify-new`.

**Success Criteria**:
- [ ] Step 1 exits 0 and prints `Scaffolded "Verify Adventure" in /tmp/xyzzy-verify-new`
- [ ] `/tmp/xyzzy-verify-new/adventure.yaml` exists, with `meta.id: xyzzy-verify-new`, `meta.title: Verify Adventure`, and `premise: A premise for verification.`
- [ ] `/tmp/xyzzy-verify-new/saves/` exists
- [ ] A README and commented example room/item/character/beat files are present in the scaffold (`rooms/example.yaml`, `items/example.yaml`, `characters/example.yaml`, `beats/example.yaml`)
- [ ] Step 2 exits 0 and prints `✓ .../adventure.yaml is valid`

**If Blocked**: If prompting hangs or an answer is dropped under piped stdin, that's a real regression in the prompt loop (`src/cli/commands/new.ts`) — report it, don't paper over it.

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

## Verification Rules

- Never use mocks or fakes
- Test environments must be fully running copies of real systems
- Scratch directories (`/tmp/xyzzy-verify-*`, temp `XDG_CONFIG_HOME`) are always cleaned up after each scenario, and never point at the developer's real config or the checked-in `examples/` directory
- If any success criterion fails, verification fails
- Ask developer for help if blocked, don't guess
