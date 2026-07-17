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

> xyzzy is in early development. Once published:

```bash
npm install -g xyzzy
```

You'll also need a local model server running (for example
[Ollama](https://ollama.com)) or any OpenAI-compatible endpoint.

## Usage

xyzzy is a single CLI with four commands.

### Create an adventure

```bash
xyzzy new my-adventure
```

Scaffolds a new adventure directory: a minimal valid `adventure.yaml`, a
`saves/` folder, a README, and commented examples of a room and a character so
you can see the optional structure.

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
| `/state`       | Dump the current game state (debugging). |
| `/log`         | Show the log file path.                  |
| `/help`        | Show meta commands.                      |
| `/quit`        | Exit.                                    |

Options: `--save <slot>` to resume a specific save, `--provider <name>` to
choose an LLM provider for the session.

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

### Configure providers

```bash
xyzzy config list          # show configured providers (the default is marked *)
xyzzy config use <name>    # set the default provider
xyzzy config test [name]   # ping a provider's endpoint (defaults to the default)

# add (or replace) a named provider:
xyzzy config add <name> --model <model> [--kind <kind>] \
  [--base-url <url>] [--api-key-env <VAR>]
```

`--kind` defaults to `openai-compatible`; `--base-url` defaults to the local
Ollama endpoint (`http://localhost:11434/v1`). The first provider you add
becomes the default. For example:

```bash
xyzzy config add local  --model llama3.1 --base-url http://localhost:11434/v1
xyzzy config add cloud  --kind openai --model gpt-4o --api-key-env OPENAI_API_KEY
```

Global provider settings live in `~/.config/xyzzy/config.json`. An adventure can
override the model/provider with its own `xyzzy.config.json`. API keys for cloud
providers are read from the environment (via `--api-key-env`) and never written
to disk. Resolution order: `--provider` flag → adventure config → global default.

## Documentation

- **[Data Model](docs/data-model.md)** — full reference for adventures, game
  state, characters, and actions.
- **[Design](docs/plans/2026-07-13-xyzzy-design.md)** — architecture and design
  decisions.

## Tech stack

TypeScript (ESM), [Ink](https://github.com/vadimdemedes/ink) for the terminal
UI, the [Vercel AI SDK](https://sdk.vercel.ai) for model calls and tool-use, and
[zod](https://zod.dev) for schemas and validation.

## License

TBD.
