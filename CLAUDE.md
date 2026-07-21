## Project Overview

**xyzzy**: A toolkit for building and playing text adventures with local LLMs.

### Problem

Existing AI-narrated interactive fiction tools either rely on raw chat history (which drifts and doesn't survive long games) or send your game data to a cloud provider. Authors want a lightweight way to describe a world — from a one-paragraph premise to a fully mapped set of rooms, items, and characters — and have it stay coherent and playable entirely on a local model.

### Approach

An adventure is authored as YAML content describing the world. Playing it creates a schema-validated game state (location, inventory, flags, per-character data) that a turn loop keeps in sync: the model narrates and emits typed tool-call actions, which are validated and folded into state through a pure reducer, then autosaved. State lives outside the chat history, so games are saveable, resumable, and testable independent of context window limits.
