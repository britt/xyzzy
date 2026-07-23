# Implementation Plan: `xyzzy new <kind>` entity subcommands

Adds `xyzzy new room|item|character|beat` subcommands alongside the existing
`xyzzy new <name>` adventure scaffold. Each prompts (via an Ink form) for the
entity's scalar fields, letting any field be skipped (→ commented placeholder
in the output YAML) or supplied up front via a CLI flag, then writes the file
into the adventure's conventional `<kind>/` directory.

Design decisions locked in during planning (see conversation, not repeated
here in detail):

- Only top-level **scalar** fields (description, persona, location, trigger)
  are promptable/flaggable. Structural fields (`exits`, `history`, `state`,
  `beats`, `interactions`, `effects`) are never prompted — always emitted as
  commented placeholder YAML for offline hand-editing.
- `room`/`item`/`character` take `<name>` as the required positional; `id`
  defaults to a slug of `name`, overridable with `--id`.
- `beat` has no `name` field in the schema — its positional argument is
  `<id>` directly.
- Adventure directory: `--adventure <path>` flag, defaults to `process.cwd()`.
- Interactive form only runs when stdin is a TTY and `--non-interactive`
  wasn't passed; otherwise unset fields are skipped straight to placeholders.
- Refuses to overwrite an existing file at the target path, and refuses to
  write an `id` that already exists among that kind's currently-defined
  entities (inline in `adventure.yaml` or in another file under the kind
  dir).

Follow strict TDD per `CLAUDE.md` for every task below: write the test file
first, watch it fail for the right reason, then write minimal code to pass.
Commit after each task (or each RED→GREEN cycle within a task, for the
larger ones). Update `PROGRESS.md` after each task per the required format.

---

## Task 1: `slug` utility

**Files**: `src/util/slug.ts`, `src/util/slug.test.ts`

`slugify(input: string): string` — lowercase; collapse runs of
non-alphanumeric characters to a single `-`; trim leading/trailing `-`.

**RED** — test cases:
- `"The Vault"` → `"the-vault"`
- `"Old   Coin!!"` → `"old-coin"`
- leading/trailing whitespace and punctuation trimmed (`"  Grimble's Lair "` → `"grimbles-lair"`)
- collapses multiple separators (`"a--b__c"` → `"a-b-c"`)
- already-slugged input passes through unchanged (`"cavern"` → `"cavern"`)

**GREEN**: minimal regex-based implementation.

---

## Task 2: `entityWriter` — field specs + pure YAML rendering

**Files**: `src/world/entityWriter.ts`, `src/world/entityWriter.test.ts`

Define per-kind scalar field specs and the pure renderer, with no fs access
yet:

```ts
export type EntityKind = "room" | "item" | "character" | "beat";

export interface EntityFieldSpec {
  key: string;         // e.g. "description"
  label: string;       // prompt label, e.g. "Description"
  placeholder: string; // comment placeholder shown when skipped
}

export const ENTITY_FIELDS: Record<EntityKind, EntityFieldSpec[]>;
// room:      [description]
// item:      [description, location]
// character: [persona, location]
// beat:      [description, trigger]

export interface EntityWriteInput {
  kind: EntityKind;
  id: string;
  name?: string; // room/item/character only; absent for beat
  values: Record<string, string | undefined>; // scalar field key -> value, or undefined if skipped
}

export function renderEntityYaml(input: EntityWriteInput): string;
```

`renderEntityYaml` writes `id` (and `name`, if present) as plain YAML
key/value lines, then one line per scalar field spec — the value if
supplied, else a commented `# key: <placeholder>` line — then a trailing
commented block per kind for its structural fields:

- room: `# exits:\n#   north: <room id>`
- item: (none beyond its scalars)
- character: `# history: []\n# state: {}\n# beats:\n#   - id: <beat id>\n#     description: <what happens>`
- beat: `# effects:\n#   - type: setGameState\n#     key: <flag>\n#     value: <value>`

**RED** — test cases per kind (room, item, character, beat), each with two
scenarios:
- all scalar fields supplied → exact expected YAML string, nothing commented
  except the structural block
- all scalar fields skipped (`undefined`) → id/name plain, every scalar
  field commented with its placeholder, structural block present
- a mixed case (some supplied, some skipped) for at least one kind

**GREEN**: implement `ENTITY_FIELDS` and `renderEntityYaml` to satisfy the
exact string assertions.

---

## Task 3: `entityWriter` — path + id-collision detection

**Files**: same as Task 2, additive.

```ts
export function entityFilePath(adventureDir: string, kind: EntityKind, id: string): string;
// <adventureDir>/<kind + "s" pluralized per KIND_DIR>/<id>.yaml
// room -> rooms/, item -> items/, character -> characters/, beat -> beats/

export function findEntityIdConflict(adventureDir: string, kind: EntityKind, id: string): string | undefined;
// Loads the adventure (readAdventureFile from world/loader), scans
// entities[kind+"s"] (or top-level `beats` for kind "beat") for a
// matching id, and returns a human-readable location string if found
// (e.g. the source description used elsewhere), else undefined.
```

Reuse `readAdventureFile` from `src/world/loader.ts` (already merges
conventional directories) rather than re-implementing directory scanning.

**RED** — test cases (using a temp dir fixture, e.g.
`mkdtempSync(join(tmpdir(), "xyzzy-entitywriter-"))` seeded with a minimal
`adventure.yaml` + a `rooms/cavern.yaml`, mirroring the pattern in
`src/tui/App.test.tsx`):
- `entityFilePath` returns the correct pluralized path for each of the four
  kinds
- `findEntityIdConflict` returns `undefined` for a fresh id
- `findEntityIdConflict` returns a defined value when the id already exists
  as an inline entity in `adventure.yaml`
- `findEntityIdConflict` returns a defined value when the id already exists
  in another file under the kind directory
- `findEntityIdConflict` for kind `"beat"` checks the top-level `beats` list,
  not `entities`

**GREEN**: implement using `readAdventureFile` + a plain object scan.

---

## Task 4: `entityWriter` — `writeEntityFile` (fs side effects)

**Files**: same as Task 2/3, additive.

```ts
export function writeEntityFile(adventureDir: string, input: EntityWriteInput): { path: string };
```

Behavior:
1. Resolve `adventure.yaml` under `adventureDir` (reuse
   `resolveAdventureFile`); throw a clear error if it doesn't exist
   ("No such adventure at <path>. Run `xyzzy new <name>` first.").
2. Compute the target path via `entityFilePath`.
3. Throw if a file already exists at that path (never overwrite).
4. Throw if `findEntityIdConflict` returns a conflict, naming the id and
   where it's already defined.
5. `mkdirSync(dirname(path), { recursive: true })`.
6. `writeFileSync(path, renderEntityYaml(input), "utf8")`.
7. Return `{ path }`.

**RED** — test cases (temp dir fixtures):
- writes the file and creates the kind directory when it doesn't exist yet
- refuses (throws) when the target file already exists, without touching it
- refuses (throws) on an id conflict, without writing
- refuses (throws) with a clear message when `adventureDir` has no
  `adventure.yaml`
- happy path for all four kinds, asserting file contents via `readFileSync`

**GREEN**: implement per above.

---

## Task 5: `EntityForm` — Ink prompt component

**Files**: `src/cli/forms/EntityForm.tsx`, `src/cli/forms/EntityForm.test.tsx`

```tsx
export interface FormFieldSpec {
  key: string;
  label: string;
  defaultValue?: string; // pre-filled, editable; Enter accepts it as-is
}

export interface EntityFormProps {
  fields: FormFieldSpec[];
  onDone: (answers: Record<string, string | undefined>) => void;
}

export function EntityForm({ fields, onDone }: EntityFormProps): JSX.Element;
```

Renders one field at a time (label + `ink-text-input` `TextInput`,
pre-filled with `defaultValue` if present, with a "(Enter to skip)" hint
when there's no default). On submit of a field: if the field had no default
and the submitted value is empty, record `undefined`; otherwise record the
submitted value. Advances to the next field; after the last field, calls
`onDone` with the full answers map and renders nothing further.

**RED** — test cases, using `ink-testing-library` (`render`) following the
`type()` helper pattern in `src/tui/App.test.tsx` (write chars, then `\r`,
with a tick between renders):
- prompts fields in order, one visible at a time
- typing a value and pressing Enter records it and advances
- pressing Enter on an empty field with no default records `undefined` (skip)
- pressing Enter on a field with a `defaultValue` and no typed input records
  the default value (accept-as-is)
- after the last field, `onDone` is called exactly once with the full
  expected answers map
- an empty `fields` array calls `onDone({})` immediately without rendering
  prompts

**GREEN**: implement the component to satisfy these.

---

## Task 6: `newEntity` — command orchestration

**Files**: `src/cli/commands/newEntity.ts`, `src/cli/commands/newEntity.test.ts`

```ts
export interface NewEntityOptions {
  kind: EntityKind;
  positional: string; // name for room/item/character; id for beat
  adventure?: string; // defaults to process.cwd()
  id?: string;         // room/item/character only
  description?: string;
  location?: string;
  persona?: string;
  trigger?: string;
  nonInteractive?: boolean;
}

export async function newEntity(opts: NewEntityOptions): Promise<void>;
```

Logic:
1. `adventureDir = opts.adventure ?? process.cwd()`.
2. `id = kind === "beat" ? opts.positional : (opts.id ?? slugify(opts.positional))`.
3. `name = kind === "beat" ? undefined : opts.positional`.
4. Build `values` from whichever of `ENTITY_FIELDS[kind]` were supplied as
   flags (`description`, `location`, `persona`, `trigger` — only the ones
   relevant to `kind` are ever read).
5. Compute `remaining` = fields in `ENTITY_FIELDS[kind]` not already
   supplied via flag.
6. If `remaining.length > 0` and interactive
   (`process.stdin.isTTY && !opts.nonInteractive`): render `EntityForm` for
   `remaining` (each field's `defaultValue` left unset — these are plain
   skippable prompts, not pre-filled, except `id` is never itself a form
   field per the locked-in design in the plan header — flag-only), await
   answers via a Promise wrapping `onDone`, merge into `values`.
   Otherwise: leave `remaining` fields as `undefined` in `values`.
7. Call `writeEntityFile(adventureDir, { kind, id, name, values })`.
8. `console.log` a confirmation with the path relative to `adventureDir`,
   plus a note if any fields were left as placeholders.

**RED** — test cases, forcing the non-interactive path
(`nonInteractive: true`) so tests don't need a TTY, using a temp adventure
fixture:
- all relevant flags supplied → file written with no placeholders, no
  attempt to import/render `EntityForm` (structure the code so the
  interactive branch is never reached — e.g. assert via a spy that `render`
  from `ink` is not called, or structure `newEntity` so the Ink import is
  dynamic/lazy and only exercised when needed)
- some flags missing + `nonInteractive: true` → those fields land as
  `undefined` → placeholders in the written file
- `kind: "beat"` → positional used directly as `id`, no `name` written, no
  `--id` flag read
- rejects (rejects the promise) when the target adventure directory has no
  `adventure.yaml`
- rejects when the id collides with an existing entity

**GREEN**: implement per above.

---

## Task 7: CLI wiring

**Files**: `src/cli/index.ts` (no dedicated test — `index.ts` is excluded
from the coverage config; verify manually per the steps below)

Add four subcommands under the existing `new` command (verified locally
that Commander correctly falls through `xyzzy new <name>` to the parent's
own action when the first token doesn't match a registered subcommand
name):

```ts
const newCmd = program
  .command("new")
  .argument("<name>", "adventure name / target directory")
  .description("scaffold a new adventure")
  .action((name: string) => newAdventure(name));

newCmd
  .command("room")
  .argument("<name>", "room name")
  .option("--adventure <path>", "adventure directory", process.cwd())
  .option("--id <id>", "override the generated id")
  .option("--description <text>", "room description")
  .option("--non-interactive", "never prompt; leave unset fields as placeholders")
  .description("create a new room")
  .action((name, opts) => newEntity({ kind: "room", positional: name, ...opts }));

newCmd
  .command("item")
  .argument("<name>", "item name")
  .option("--adventure <path>", "adventure directory", process.cwd())
  .option("--id <id>", "override the generated id")
  .option("--description <text>", "item description")
  .option("--location <id>", "starting room or character id")
  .option("--non-interactive", "never prompt; leave unset fields as placeholders")
  .description("create a new item")
  .action((name, opts) => newEntity({ kind: "item", positional: name, ...opts }));

newCmd
  .command("character")
  .argument("<name>", "character name")
  .option("--adventure <path>", "adventure directory", process.cwd())
  .option("--id <id>", "override the generated id")
  .option("--persona <text>", "character persona")
  .option("--location <id>", "starting room id")
  .option("--non-interactive", "never prompt; leave unset fields as placeholders")
  .description("create a new character")
  .action((name, opts) => newEntity({ kind: "character", positional: name, ...opts }));

newCmd
  .command("beat")
  .argument("<id>", "beat id")
  .option("--adventure <path>", "adventure directory", process.cwd())
  .option("--description <text>", "what happens")
  .option("--trigger <text>", "trigger notes surfaced to the model")
  .option("--non-interactive", "never prompt; leave unset fields as placeholders")
  .description("create a new story beat")
  .action((id, opts) => newEntity({ kind: "beat", positional: id, ...opts }));
```

**Verify manually** (no unit test, per existing convention for `index.ts`):
- `bun run start -- new --help` lists all four subcommands
- `bun run start -- new room --help` shows its flags
- `bun run start -- new my-adventure` still scaffolds an adventure (unchanged
  behavior smoke check)

---

## Task 8: Docs

**Files**: `README.md`, `VERIFICATION_PLAN.md`

- README: extend the existing `xyzzy new` section with the four new
  subcommands, their flags, and a short example of the commented-placeholder
  output.
- `VERIFICATION_PLAN.md`: add a new scenario exercising
  `xyzzy new room|item|character|beat --non-interactive` with a mix of flags
  supplied/omitted against a scratch copy of `examples/cave-of-echoes`,
  asserting the written file's contents and that `xyzzy validate` still
  passes afterward. Note that the interactive (TTY) form path is validated
  the same way Scenario 5 already handles Ink TTY flows — extend Scenario 5
  or add a sibling scenario, developer's call at review time.

---

## Task 9: Final pass

1. `bun run test` — all green.
2. `bun run vitest run --coverage` — confirm 90%/90%/85%/90% thresholds met
   for every new file; if `EntityForm.tsx` or `newEntity.ts` branches fall
   short, add the missing test cases rather than relaxing scope.
3. `bun run build` — zero errors.
4. `bun run lint` — zero errors/warnings.
5. Update `PROGRESS.md` with the final task entry.
6. Final commit.
