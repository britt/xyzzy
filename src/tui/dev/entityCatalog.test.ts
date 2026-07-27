import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABELS, entriesForCategory } from "./entityCatalog.js";
import type { Adventure } from "../../world/schema.js";

const adventure: Adventure = {
  meta: { id: "a", title: "A", version: "1" },
  premise: "p",
  start: {},
  entities: {
    rooms: [{ id: "cavern", name: "Cavern", description: "d" }],
    items: [{ id: "key", name: "Key", description: "d" }],
    characters: [{ id: "hermit", name: "Hermit", persona: "p", history: [], state: {} }],
  },
  beats: [{ id: "won-the-key", description: "d" }],
};

describe("CATEGORIES", () => {
  it("lists categories in the required order", () => {
    expect(CATEGORIES).toEqual(["config", "beats", "characters", "rooms", "items"]);
  });

  it("has a display label for every category", () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });
});

describe("entriesForCategory", () => {
  it("returns an empty list for the config category", () => {
    expect(entriesForCategory(adventure, "config")).toEqual([]);
  });

  it("lists rooms with kind, id, and name as the label", () => {
    expect(entriesForCategory(adventure, "rooms")).toEqual([
      { kind: "room", id: "cavern", label: "Cavern" },
    ]);
  });

  it("lists items with kind, id, and name as the label", () => {
    expect(entriesForCategory(adventure, "items")).toEqual([
      { kind: "item", id: "key", label: "Key" },
    ]);
  });

  it("lists characters with kind, id, and name as the label", () => {
    expect(entriesForCategory(adventure, "characters")).toEqual([
      { kind: "character", id: "hermit", label: "Hermit" },
    ]);
  });

  it("lists beats with kind, id, and the beat's own id as the label (beats have no name)", () => {
    expect(entriesForCategory(adventure, "beats")).toEqual([
      { kind: "beat", id: "won-the-key", label: "won-the-key" },
    ]);
  });

  it("returns an empty list for a category with no entities defined", () => {
    const empty: Adventure = { meta: adventure.meta, premise: "p", start: {} };
    expect(entriesForCategory(empty, "rooms")).toEqual([]);
    expect(entriesForCategory(empty, "beats")).toEqual([]);
  });
});
