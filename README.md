# xyzzy

A toolkit for building and playing text adventures with local LLMs.

xyzzy lets you **author** an interactive fiction world and **play** it in your
terminal, with a local language model acting as the game master. You describe a
world — as little as a one-paragraph premise or as much as a fully mapped set of
rooms, items, and characters — and xyzzy runs a turn-by-turn game where the
model narrates, voices characters, and keeps the world consistent.

It runs against **local models** (Ollama, LM Studio, llama.cpp, vLLM, or any
OpenAI-compatible endpoint), so your games stay on your machine.

> The name is a nod to the classic *Colossal Cave Adventure* magic word.

## What makes xyzzy different

- **Author as much or as little as you want.** A valid adventure can be three
  fields (`meta`, `premise`, `start`). Add rooms, items, and characters to make
  play more structured and deterministic. See the [Data Model](docs/data-model.md).
- **Real game state, not just chat history.** xyzzy keeps explicit,
  schema-validated state — player location, inventory, flags, and per-character
  data — that the model reads and updates through typed tool-calls. State is
  saved to disk and survives long games, independent of the context window.
- **Characters that remember.** Each character carries a `history` (short
  summaries of what's happened to them) and an open `state` bag you define
  (`{ trust: 20, mood: "wary" }`), so they stay consistent across a session.
- **Bring your own model.** Providers are pluggable via config; the default
  targets any OpenAI-compatible local server.

## How it works

An **adventure** is authored content (`adventure.yaml`) describing the world.
When you play, xyzzy creates a **game state** — a running save seeded from the
adventure — and drives a turn loop:

1. You type a command.
2. xyzzy sends the model your input, a digest of the current game state, and
   recent history.
3. The model narrates the outcome and emits typed **actions** (move, take item,
   update a character, set a flag) as tool-calls.
4. xyzzy validates those actions and folds them into the game state through a
   pure reducer, then autosaves.
5. The narration streams back to your terminal.

Because state lives in a structured, validated form — not just the conversation
— the world stays coherent and games are saveable, resumable, and testable. The
full shapes are documented in **[docs/data-model.md](docs/data-model.md)**.

## Installation

```bash
npm install -g @britt/xyzzy
```

You'll also need a local model server running (for example
[Ollama](https://ollama.com)) or any OpenAI-compatible endpoint.

## Usage

xyzzy is a single CLI: `new` (plus `new room|item|character|beat`), `play`,
`dev`, `validate`, `map`, and `config` (plus its `list|add|use|test|models`
subcommands).

### Create an adventure

```bash
xyzzy new my-adventure
```

Prompts for the game's title (defaults to the directory name, `my-adventure`
here) and an optional premise (defaults to placeholder text if you skip it),
then scaffolds a new adventure directory: a minimal valid `adventure.yaml`, a
README, and commented examples of a room, an item, a character, and a story
beat so you can see the optional structure.

#### Add entities

```bash
xyzzy new room "Old Cistern" --description "A dank stone cistern, long since run dry."
xyzzy new item "Rusted Key" --location cavern
xyzzy new character "Old Hermit" --persona "A reclusive hermit who trusts no one." --location cavern
xyzzy new beat won-the-key --description "The player receives the rusted key."
```

Each writes a new file into the adventure's conventional directory
(`rooms/old-cistern.yaml`, `items/rusted-key.yaml`, etc.), with `id` defaulted
to a slug of the name (override with `--id`) — `beat`'s positional argument is
its `id` directly, since beats have no `name` field. Every field besides the
name/id can be supplied as a flag (`--description`, `--location`, `--persona`,
`--trigger`) or left unset. Unset fields are prompted for interactively (skip
any prompt with a bare Enter) when running in a real terminal; pass
`--non-interactive`, or pipe/redirect stdin, to skip prompting entirely.
Fields left unset — whether skipped at a prompt or never supplied at all — are
written as commented placeholders you can fill in later:

```yaml
id: rusted-key
name: Rusted Key
description: A tarnished iron key, flecked with rust.
# location: <room or character id where this item starts>
```

Note that `description` (room/item/beat) and `persona` (character) are
required by the schema — skipping them is allowed, the same as any other
field, but `xyzzy validate` will flag that entity until you fill it in.
Refuses to overwrite an existing file, and refuses an `id` that collides with
an entity the adventure already defines elsewhere. Use `--adventure <path>` to
target an adventure directory other than the current one.

### Play

```bash
xyzzy play my-adventure
```

Launches the terminal UI: a scrolling narrative with an input line at the
bottom. Type commands in plain language. In-game meta commands:

| Command        | Action                                   |
| -------------- | ---------------------------------------- |
| `/save [slot]` | Save the game (defaults to autosave slot).|
| `/load [slot]` | Load a saved game.                       |
| `/model`       | Show or switch the model (`/model list`, `/model <id>`). |
| `/provider`    | Show or switch the provider (`/provider list\|use\|url`). |
| `/map`         | Draw an ASCII map of rooms, connections, and who's where. |
| `/state`       | Dump the current game state (debugging). |
| `/transcript`  | Print the full conversation transcript.  |
| `/log`         | Show the log file path.                  |
| `/timing [on\|off]` | Toggle turn/LLM-call timing display. |
| `/help`        | Show meta commands.                      |
| `/quit`        | Exit.                                    |

Saves are global, not part of the adventure directory — they live under
`$XDG_STATE_HOME/xyzzy/<adventure id>/saves/` (default
`~/.local/state/xyzzy/<adventure id>/saves/`), keyed by the adventure's
`meta.id`, so they survive moving or reinstalling the adventure itself.

Options: `--save <slot>` to resume a specific save, `--provider <name>` to
choose an LLM provider for the session, and `--log-llm` to record every
detector/narrator LLM call this session makes to a session log file (see
[LLM Logs](#llm-logs) below). Recording is off by default here — it's a
debugging aid, and `xyzzy dev` always does it.

### Develop

```bash
xyzzy dev my-adventure
```

Opens a two-pane workbench over the whole adventure: a category sidebar on the
left (Adventure Config, Beats, Characters, Rooms, Items, LLM Logs) and a
content pane on the right showing the selected entry's fields as labelled rows
— not raw YAML. Unset optional fields appear dimmed with the same placeholder
text `xyzzy new` would write.

| Key                | Action                                              |
| ------------------ | --------------------------------------------------- |
| `Tab` / `Shift+Tab`| Next / previous category (wraps).                    |
| `↑` / `↓`          | Move through the selected category's entries — or scroll the log, in LLM Logs. |
| `←` / `→`          | Move between sessions (LLM Logs only).               |
| `PgUp` / `PgDn`    | Scroll the content pane when an entry doesn't fit.   |
| `e`                | Edit the selected entry's file in `$EDITOR`.          |
| `p`                | Play-test: New Game, or resume a save slot.           |
| `Escape`           | Return focus to the sidebar.                          |
| `q`                | Quit.                                                 |

A footer along the bottom lists the keys that work *right now*: entity
navigation only appears when the selected category has more than one entry,
`e` disappears in an empty category, and while the play submenu or an active
play session has the keyboard it lists only that context's keys.

Pressing `e` opens the file the selected entry is actually defined in — which
may be `adventure.yaml` itself, or a file under `rooms/`, `items/`, etc. that
holds several entities under a name unrelated to any of their ids. When the
editor exits the whole
adventure is reloaded and re-validated. If it no longer validates, the content
pane shows the errors inline and a `⚠` appears beside that entry in the
sidebar — the last good version is kept, so every other entity stays browsable
and you can fix the file with another `e`. Malformed YAML is reported the same
way rather than ending the session.

Pressing `p` offers **New Game** or any existing save slot, then embeds the
same play session `xyzzy play` uses directly in the content pane. `Escape`
hands the keyboard back to the sidebar *without* ending the session, so you can
browse or edit mid-playthrough; `p` re-focuses the running session with its
scrollback intact. `/quit` inside the play pane ends just that session and
returns to browsing. Note that `q` only quits the tool when the sidebar has
focus — while you're playing it's just the letter "q".

#### LLM Logs

The last sidebar category, **LLM Logs**, lists every recorded session for this
adventure, newest first, labelled with when it started and what launched it
(`dev` or `play`). Selecting one shows, through the same labelled-row rendering
every other category uses: the session header (start time, provider, save slot,
whether it resumed a save) followed by the system prompt, then each turn in
order — the player's input, the detector call's context and detection, and the
narrator call's digest, narration and actions, each with its duration. A call
that *failed* records its error in place of a result, which is usually the
reason you came looking.

Each turn opens with a solid rule and the exchanges inside it are separated by
dotted ones, so the structure survives scrolling. The system prompt is shown
once for the session rather than repeated on every turn — it's constant, and
repeating it buried the turn's own exchange. If it ever *does* change
mid-session (editing the adventure in `xyzzy dev` rebuilds it), the new one
appears on the turn it changed, labelled `System prompt (changed)`.

Because a log is a document you read rather than a record you inspect, the
arrows swap roles in this category: `↑`/`↓` scroll the log a line at a time
(`PgUp`/`PgDn` still move by the screenful), and `←`/`→` move between sessions.
Every other category keeps `↑`/`↓` on entry selection. The footer tracks
whichever set applies.

The category is read-only: `e` does nothing there and never appears in the
footer. Logs also never carry the `⚠` glyph, since they aren't part of
validation. A log that can't be parsed reports the problem inline, naming the
bad line, the same way a broken YAML file does.

`xyzzy dev` records every play-test session it starts. A live session keeps the
content pane, so browse to LLM Logs after `/quit`-ing it to read its own log;
the sidebar lists it as soon as it starts either way. Logs sit beside saves
under `$XDG_STATE_HOME/xyzzy/<adventure id>/logs/<session>.jsonl` (default
`~/.local/state/xyzzy/...`), one JSON-lines file per session — so they're
greppable outside the tool, and deleting them is just `rm`.

Options: `--provider <name>` to choose the LLM provider used for play-testing.
Browsing and editing need no model at all.

`e` uses `$VISUAL`, falling back to `$EDITOR`, then `vi`. The value is a
command line, not just a program name, so flags are respected — and a GUI
editor needs its wait flag or it returns immediately and xyzzy reloads before
you've typed anything:

```bash
export EDITOR="code --wait"   # or: subl --wait, "zed --wait", vim, nano
```

### Logs & troubleshooting

The terminal UI can't print diagnostics without corrupting the screen, so
errors and lifecycle events are written to a log file instead (as JSON lines):

```
$XDG_STATE_HOME/xyzzy/xyzzy.log   # default: ~/.local/state/xyzzy/xyzzy.log
```

Run `/log` in-game to see the exact path. Provider failures record the full
detail — HTTP status, request URL, and the raw response body — so a generic
error like `Invalid JSON response` becomes diagnosable (e.g. the endpoint
returned HTML because the base URL is missing `/v1`, or a model that doesn't
support tool-calls). Set `XYZZY_LOG=0` to disable logging.

### Validate

```bash
xyzzy validate my-adventure
```

Checks the adventure against the schema and reports errors with the exact path
(e.g. `entities.rooms[2].exits.north → unknown room "attic"`), including
cross-reference checks that exits and locations point to real ids. Exits
non-zero on failure, so it works in CI.

### Map

```bash
xyzzy map my-adventure
```

Computes the room layout from the adventure's authored rooms and exits and
writes it to `map.yaml` beside `adventure.yaml` — a static cartography
artifact (each room's grid position plus its exits) that also embeds an
`ascii` rendering, the same one `/map` shows in-game, seeded with the
adventure's starting state. Useful for reviewing the layout without loading
the game.

### Configure providers

```bash
xyzzy config list           # show configured providers (the default is marked *)
xyzzy config use <name>     # set the default provider
xyzzy config test [name]    # ping a provider's endpoint (defaults to the default)
xyzzy config models [name]  # list the models the provider's endpoint reports

# add (or replace) a named provider:
xyzzy config add <name> --model <model> [--kind <kind>] \
  [--base-url <url>] [--api-key-env <VAR>]
```

`--kind` defaults to `openai-compatible`; `--base-url` defaults to the local
Ollama endpoint (`http://localhost:11434/v1`). The first provider you add
becomes the default. For example:

```bash
xyzzy config add local  --model llama3.1 --base-url http://localhost:11434/v1
xyzzy config add cloud  --model gpt-4o --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY
```

`lmstudio`, `ollama`, `openai`, and `anthropic` are also accepted as `--kind`
values. `lmstudio`/`ollama` behave identically to `openai-compatible` (same
code path, different label in `xyzzy config list`). `openai`/`anthropic` are
reserved for a future native cloud SDK integration and currently fail at play
time with an error telling you to use an `openai-compatible` endpoint
instead — any OpenAI-compatible cloud API (like `api.openai.com` above) works
today via `--kind openai-compatible`.

Global provider settings live under `$XDG_CONFIG_HOME/xyzzy/config.json`
(default `~/.config/xyzzy/config.json`). An adventure can override the
model/provider with its own `xyzzy.config.json`. API keys for cloud providers
are read from the environment (via `--api-key-env`) and never written to disk.
Resolution order: `--provider` flag → adventure config → global default.

## Documentation

- **[Data Model](docs/data-model.md)** — full reference for adventures, game
  state, characters, and actions.
- **[Design](docs/plans/2026-07-13-xyzzy-design.md)** — original architecture
  and design decisions. Later features have their own design docs under
  [`docs/plans/`](docs/plans/), including
  [structured action detection](docs/plans/2026-07-16-action-detection-design.md),
  [character beats and interactions](docs/plans/2026-07-20-character-beats-design.md),
  [turn/LLM-call timing](docs/plans/2026-07-21-turn-timing-design.md),
  [the `xyzzy dev` TUI](docs/plans/2026-07-27-dev-tool-tui-design.md), and
  [the LLM debugging view](docs/plans/2026-07-28-llm-debug-log-design.md).

## Tech stack

TypeScript (ESM), [Ink](https://github.com/vadimdemedes/ink) for the terminal
UI, the [Vercel AI SDK](https://sdk.vercel.ai) for model calls and tool-use, and
[zod](https://zod.dev) for schemas and validation.

## License

[MIT](LICENSE)
