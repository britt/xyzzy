import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";

export interface ScaffoldOptions {
  /** target directory; refuses to overwrite an existing non-empty dir */
  dir: string;
  /** human-readable game title, stored as `meta.title` */
  title: string;
  /** optional premise text; a placeholder is used when omitted */
  premise?: string;
}

const DEFAULT_PREMISE =
  "Describe the premise here: the opening scene, the tone, and what the " +
  "player is trying to do. This is the one thing the model always sees, so " +
  "make it count.";

/** Turn a directory/title into a stable, lowercase, hyphenated `meta.id`. */
function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "adventure";
}

function assertDirIsWritable(dir: string): void {
  if (!existsSync(dir)) return;
  if (!statSync(dir).isDirectory()) {
    throw new Error(
      `Refusing to scaffold into ${dir}: path already exists and is not a directory.`,
    );
  }
  if (readdirSync(dir).length > 0) {
    throw new Error(
      `Refusing to scaffold into ${dir}: directory already exists and is not empty.`,
    );
  }
}

function writeAdventureYaml(
  dir: string,
  id: string,
  title: string,
  premise: string,
): void {
  const header =
    `# ${title} — scaffolded by \`xyzzy new\`.\n` +
    "#\n" +
    "# A valid adventure needs only `meta`, `premise`, and `start`. Everything\n" +
    "# else is optional: rooms, items, characters, and beats can be authored\n" +
    "# inline under `entities:`/`beats:` here, or split into sibling directories\n" +
    "# named after each kind (rooms/, items/, characters/, beats/) — see the\n" +
    "# commented examples included in this scaffold.\n\n";
  const body = stringify({
    meta: { id, title, version: "0.1.0" },
    premise,
    start: {},
  });
  writeFileSync(join(dir, "adventure.yaml"), header + body, "utf8");
}

function writeReadme(dir: string, title: string, dirName: string): void {
  const readme =
    `# ${title}\n\n` +
    `An xyzzy adventure scaffolded with \`xyzzy new\`.\n\n` +
    "## Play it\n\n" +
    "```bash\n" +
    `xyzzy play ${dirName}\n` +
    "```\n\n" +
    "## Validate it\n\n" +
    "```bash\n" +
    `xyzzy validate ${dirName}\n` +
    "```\n\n" +
    "## Structure\n\n" +
    "- `adventure.yaml` — `meta`, `premise`, and `start`; the only required file.\n" +
    "- `rooms/`, `items/`, `characters/`, `beats/` — optional structure, one " +
    "file per entity or a whole group; see the commented examples in each " +
    "directory.\n" +
    "- `saves/` — save slots written by `/save` during play.\n";
  writeFileSync(join(dir, "README.md"), readme, "utf8");
}

function writeExample(dir: string, kind: string, comment: string): void {
  const target = join(dir, kind, "example.yaml");
  mkdirSync(join(dir, kind), { recursive: true });
  writeFileSync(target, comment, "utf8");
}

const ROOM_EXAMPLE =
  "# Rooms are optional structure the model will honor when present. Each\n" +
  "# room needs an id, name, and description; `exits` maps a direction to\n" +
  "# another room's id. Delete the `#` below to bring this room into the\n" +
  "# adventure (and give `start.room` a room id to begin here).\n" +
  "#\n" +
  "# - id: entrance\n" +
  "#   name: Cave Mouth\n" +
  "#   description: >\n" +
  "#     A jagged crack in the hillside, just wide enough to squeeze through.\n" +
  "#   exits:\n" +
  "#     down: cavern\n";

const ITEM_EXAMPLE =
  "# Items are optional. `location` is the id of the room (or character)\n" +
  "# holding the item at the start of the game.\n" +
  "#\n" +
  "# - id: lantern\n" +
  "#   name: brass lantern\n" +
  "#   description: A dented brass lantern, cold to the touch.\n" +
  "#   location: entrance\n";

const CHARACTER_EXAMPLE =
  "# Characters are optional. `persona` drives how the model voices them;\n" +
  "# `history` seeds memories; `state` is an open bag of values the model\n" +
  "# can update during play.\n" +
  "#\n" +
  "# - id: grimble\n" +
  "#   name: Grimble\n" +
  "#   persona: >\n" +
  "#     An ancient, lonely cave troll who guards the lake.\n" +
  "#   location: lake\n" +
  "#   history:\n" +
  "#     - Has guarded the still lake for longer than he can count.\n" +
  "#   state:\n" +
  "#     trust: 10\n" +
  "#     mood: wary\n";

const BEAT_EXAMPLE =
  "# Beats are optional narrative goals. `trigger` tells the model when to\n" +
  "# advance it; `effects` are declarative state changes applied atomically\n" +
  "# when it does, using the same verbs as the model's own tool calls.\n" +
  "#\n" +
  "# - id: find-light\n" +
  "#   description: The player lights the lantern and can see in the dark.\n" +
  "#   trigger: The player finds a way to spark the lantern.\n" +
  "#   effects:\n" +
  "#     - type: setFlag\n" +
  "#       key: lanternLit\n" +
  "#       value: true\n";

/**
 * Write a minimal valid adventure: `adventure.yaml`, a `saves/` dir, a README,
 * and commented example room/item/character/beat files. Refuses to overwrite
 * an existing non-empty directory.
 */
export async function scaffoldAdventure(opts: ScaffoldOptions): Promise<void> {
  const dir = resolve(opts.dir);
  assertDirIsWritable(dir);
  mkdirSync(dir, { recursive: true });

  const dirName = basename(dir);
  const id = slugify(dirName);
  const premise = opts.premise?.trim() || DEFAULT_PREMISE;

  writeAdventureYaml(dir, id, opts.title, premise);
  writeReadme(dir, opts.title, dirName);
  mkdirSync(join(dir, "saves"), { recursive: true });
  writeExample(dir, "rooms", ROOM_EXAMPLE);
  writeExample(dir, "items", ITEM_EXAMPLE);
  writeExample(dir, "characters", CHARACTER_EXAMPLE);
  writeExample(dir, "beats", BEAT_EXAMPLE);
}
