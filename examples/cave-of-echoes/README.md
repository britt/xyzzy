# Cave of Echoes

An example xyzzy adventure — a small, fully-mapped cave in homage to *Colossal
Cave Adventure*. It uses every optional section of the schema, so it works as
both a playable demo and a reference for authoring your own worlds.

## What it shows

- **Rooms with exits** — four connected rooms (`entrance → cavern → lake/alcove`)
  whose `exits` cross-reference real room ids.
- **Items placed in the world** — the lantern and rope sit in rooms; the copper
  coin starts held by a character (an item `location` may be a room *or* a
  character id).
- **A character that remembers** — Grimble the troll carries a `persona`, a
  seeded `history`, and an open `state` bag (`trust`, `mood`, `bribed`) the
  model updates during play.
- **Story beats** — three optional goals that give the model narrative
  direction without scripting the outcome.

## Play it

> Requires the `play` command, which is not yet implemented.

```bash
xyzzy play examples/cave-of-echoes
```

## Validate it

> Requires the `validate` command, which is not yet implemented.

```bash
xyzzy validate examples/cave-of-echoes
```

The adventure is kept schema-valid with resolvable cross-references, so it also
serves as a fixture once the loader and validator land.
