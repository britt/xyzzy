import { describe, expect, it } from "vitest";
import {
  renderRoomFields,
  renderItemFields,
  renderCharacterFields,
  renderBeatFields,
  renderConfigFields,
  renderFieldsFor,
} from "./renderFields.js";
import type { Adventure, Character, Item, Room, StoryBeat } from "../../world/schema.js";

describe("renderRoomFields", () => {
  it("renders name, description, and exits", () => {
    const room: Room = {
      id: "cavern",
      name: "Cavern",
      description: "A dark cavern.",
      exits: { north: "hall" },
    };
    expect(renderRoomFields(room)).toEqual([
      { label: "Name", value: "Cavern", dim: false },
      { label: "Description", value: "A dark cavern.", dim: false },
      { label: "Exits", value: "north -> hall", dim: false },
    ]);
  });

  it("renders a dim placeholder for exits when there are none", () => {
    const room: Room = { id: "cavern", name: "Cavern", description: "d" };
    const rows = renderRoomFields(room);
    expect(rows.find((r) => r.label === "Exits")).toEqual({
      label: "Exits",
      value: "(none)",
      dim: true,
    });
  });
});

describe("renderItemFields", () => {
  it("renders location when set", () => {
    const item: Item = { id: "key", name: "Key", description: "d", location: "cavern" };
    expect(renderItemFields(item)).toEqual([
      { label: "Name", value: "Key", dim: false },
      { label: "Description", value: "d", dim: false },
      { label: "Location", value: "cavern", dim: false },
    ]);
  });

  it("renders a dim placeholder for an unset location", () => {
    const item: Item = { id: "key", name: "Key", description: "d" };
    const rows = renderItemFields(item);
    const location = rows.find((r) => r.label === "Location")!;
    expect(location.dim).toBe(true);
    expect(location.value).toContain("room or character id");
  });
});

describe("renderCharacterFields", () => {
  const base: Character = {
    id: "hermit",
    name: "Hermit",
    persona: "reclusive",
    history: [],
    state: {},
  };

  it("renders persona, location, and dim placeholders for empty structural fields", () => {
    const rows = renderCharacterFields(base);
    expect(rows).toContainEqual({ label: "Name", value: "Hermit", dim: false });
    expect(rows).toContainEqual({ label: "Persona", value: "reclusive", dim: false });
    expect(rows.find((r) => r.label === "Location")?.dim).toBe(true);
    expect(rows.find((r) => r.label === "History")).toEqual({
      label: "History",
      value: "(none)",
      dim: true,
    });
    expect(rows.find((r) => r.label === "State")).toEqual({
      label: "State",
      value: "(none)",
      dim: true,
    });
    expect(rows.find((r) => r.label === "Beats")).toEqual({
      label: "Beats",
      value: "(none)",
      dim: true,
    });
  });

  it("renders non-empty history/state/beats/interactions", () => {
    const full: Character = {
      ...base,
      location: "cavern",
      history: ["met the player"],
      state: { mood: "annoyed" },
      beats: [{ id: "confess", description: "d" }],
      interactions: [{ id: "offer-drink", description: "d", limit: 3 }],
    };
    const rows = renderCharacterFields(full);
    expect(rows.find((r) => r.label === "Location")).toEqual({
      label: "Location",
      value: "cavern",
      dim: false,
    });
    expect(rows.find((r) => r.label === "History")?.value).toBe("met the player");
    expect(rows.find((r) => r.label === "State")?.value).toContain("mood");
    expect(rows.find((r) => r.label === "Beats")?.value).toBe("confess");
    expect(rows.find((r) => r.label === "Interactions")?.value).toBe("offer-drink");
  });
});

describe("renderBeatFields", () => {
  it("renders id (not name), description, trigger, and effects", () => {
    const beat: StoryBeat = { id: "won-the-key", description: "d", trigger: "t" };
    expect(renderBeatFields(beat)).toEqual([
      { label: "id", value: "won-the-key", dim: false },
      { label: "Description", value: "d", dim: false },
      { label: "Trigger", value: "t", dim: false },
      { label: "Effects", value: "(none)", dim: true },
    ]);
  });

  it("renders a dim placeholder for an unset trigger", () => {
    const beat: StoryBeat = { id: "b", description: "d" };
    const rows = renderBeatFields(beat);
    expect(rows.find((r) => r.label === "Trigger")?.dim).toBe(true);
  });

  it("summarizes effects when present", () => {
    const beat: StoryBeat = {
      id: "b",
      description: "d",
      effects: [{ type: "setFlag", key: "k", value: true }],
    };
    expect(renderBeatFields(beat).find((r) => r.label === "Effects")).toEqual({
      label: "Effects",
      value: "1 effect(s)",
      dim: false,
    });
  });
});

describe("renderConfigFields", () => {
  it("renders meta and premise fields", () => {
    const adventure: Adventure = {
      meta: { id: "a", title: "A Title", version: "1", author: "Britt" },
      premise: "A premise.",
      start: {},
    };
    const rows = renderConfigFields(adventure);
    expect(rows).toContainEqual({ label: "Title", value: "A Title", dim: false });
    expect(rows).toContainEqual({ label: "Id", value: "a", dim: false });
    expect(rows).toContainEqual({ label: "Version", value: "1", dim: false });
    expect(rows).toContainEqual({ label: "Author", value: "Britt", dim: false });
    expect(rows).toContainEqual({ label: "Premise", value: "A premise.", dim: false });
  });

  it("renders a dim placeholder for an unset author", () => {
    const adventure: Adventure = {
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
    };
    expect(renderConfigFields(adventure).find((r) => r.label === "Author")?.dim).toBe(
      true,
    );
  });
});

describe("renderFieldsFor", () => {
  it("dispatches to the right renderer per category", () => {
    const room: Room = { id: "cavern", name: "Cavern", description: "d" };
    expect(renderFieldsFor("rooms", room)).toEqual(renderRoomFields(room));

    const item: Item = { id: "key", name: "Key", description: "d" };
    expect(renderFieldsFor("items", item)).toEqual(renderItemFields(item));

    const character: Character = {
      id: "hermit",
      name: "Hermit",
      persona: "p",
      history: [],
      state: {},
    };
    expect(renderFieldsFor("characters", character)).toEqual(
      renderCharacterFields(character),
    );

    const beat: StoryBeat = { id: "b", description: "d" };
    expect(renderFieldsFor("beats", beat)).toEqual(renderBeatFields(beat));
  });
});
