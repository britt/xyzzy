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
  it("leads with a heading naming the room and identifying it", () => {
    const room: Room = {
      id: "cavern",
      name: "Cavern",
      description: "A dark cavern.",
      exits: { north: "hall" },
    };
    expect(renderRoomFields(room)).toEqual([
      { kind: "heading", title: "Cavern", subtitle: "room · cavern" },
      { kind: "block", label: "Description", value: "A dark cavern.", dim: false },
      { kind: "list", label: "Exits", items: ["north → hall"] },
    ]);
  });

  it("renders every exit as its own list item", () => {
    const room: Room = {
      id: "cavern",
      name: "Cavern",
      description: "d",
      exits: { north: "hall", down: "pit" },
    };
    const exits = renderRoomFields(room).find((r) => r.kind === "list")!;
    expect(exits).toEqual({
      kind: "list",
      label: "Exits",
      items: ["north → hall", "down → pit"],
    });
  });

  it("leaves the exits list empty when there are none", () => {
    const room: Room = { id: "cavern", name: "Cavern", description: "d" };
    expect(renderRoomFields(room)).toContainEqual({
      kind: "list",
      label: "Exits",
      items: [],
    });
  });
});

describe("renderItemFields", () => {
  it("renders description as a block and location as a scalar", () => {
    const item: Item = { id: "key", name: "Key", description: "d", location: "cavern" };
    expect(renderItemFields(item)).toEqual([
      { kind: "heading", title: "Key", subtitle: "item · key" },
      { kind: "block", label: "Description", value: "d", dim: false },
      { kind: "scalar", label: "Location", value: "cavern", dim: false },
    ]);
  });

  it("dims an unset location and shows its placeholder", () => {
    const item: Item = { id: "key", name: "Key", description: "d" };
    const location = renderItemFields(item).find(
      (r) => r.kind === "scalar" && r.label === "Location",
    )!;
    expect(location).toMatchObject({ dim: true });
    expect("value" in location && location.value).toContain("room or character id");
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

  it("leads with a heading and renders persona as a block", () => {
    const rows = renderCharacterFields(base);
    expect(rows[0]).toEqual({
      kind: "heading",
      title: "Hermit",
      subtitle: "character · hermit",
    });
    expect(rows).toContainEqual({
      kind: "block",
      label: "Persona",
      value: "reclusive",
      dim: false,
    });
  });

  it("leaves structural lists empty when the character has none", () => {
    const rows = renderCharacterFields(base);
    for (const label of ["History", "State", "Beats", "Interactions"]) {
      expect(rows).toContainEqual({ kind: "list", label, items: [] });
    }
  });

  it("renders history, state, beats and interactions as list items", () => {
    const full: Character = {
      ...base,
      location: "cavern",
      history: ["met the player"],
      state: { mood: "annoyed", trust: 10 },
      beats: [{ id: "confess", description: "d" }],
      interactions: [{ id: "offer-drink", description: "d", limit: 3 }],
    };
    const rows = renderCharacterFields(full);
    const list = (label: string) =>
      rows.find((r) => r.kind === "list" && r.label === label);

    expect(list("History")).toEqual({
      kind: "list",
      label: "History",
      items: ["met the player"],
    });
    expect(list("State")).toEqual({
      kind: "list",
      label: "State",
      items: ["mood: annoyed", "trust: 10"],
    });
    expect(list("Beats")).toEqual({ kind: "list", label: "Beats", items: ["confess"] });
    expect(list("Interactions")).toEqual({
      kind: "list",
      label: "Interactions",
      items: ["offer-drink"],
    });
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Location",
      value: "cavern",
      dim: false,
    });
  });
});

describe("renderBeatFields", () => {
  it("uses the beat's id as its heading, since beats have no name", () => {
    const beat: StoryBeat = { id: "won-the-key", description: "d", trigger: "t" };
    expect(renderBeatFields(beat)).toEqual([
      { kind: "heading", title: "won-the-key", subtitle: "beat" },
      { kind: "block", label: "Description", value: "d", dim: false },
      { kind: "block", label: "Trigger", value: "t", dim: false },
      { kind: "list", label: "Effects", items: [] },
    ]);
  });

  it("dims an unset trigger and shows its placeholder", () => {
    const beat: StoryBeat = { id: "b", description: "d" };
    const trigger = renderBeatFields(beat).find(
      (r) => r.kind === "block" && r.label === "Trigger",
    )!;
    expect(trigger).toMatchObject({ dim: true });
  });

  it("describes each effect by type and the id it acts on", () => {
    const beat: StoryBeat = {
      id: "b",
      description: "d",
      effects: [
        { type: "setFlag", key: "lit", value: true },
        { type: "moveTo", room: "cavern" },
      ],
    };
    expect(renderBeatFields(beat)).toContainEqual({
      kind: "list",
      label: "Effects",
      items: ["setFlag · lit", "moveTo · cavern"],
    });
  });
});

describe("renderConfigFields", () => {
  const adventure: Adventure = {
    meta: { id: "a", title: "A Title", version: "1", author: "Britt" },
    premise: "A premise.",
    start: {},
    entities: {
      rooms: [
        { id: "r1", name: "R1", description: "d" },
        { id: "r2", name: "R2", description: "d" },
      ],
      items: [{ id: "i1", name: "I1", description: "d" }],
    },
    beats: [{ id: "b1", description: "d" }],
  };

  it("leads with the adventure's title and id", () => {
    expect(renderConfigFields(adventure)[0]).toEqual({
      kind: "heading",
      title: "A Title",
      subtitle: "adventure · a",
    });
  });

  it("renders version, author and premise", () => {
    const rows = renderConfigFields(adventure);
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Version",
      value: "1",
      dim: false,
    });
    expect(rows).toContainEqual({
      kind: "scalar",
      label: "Author",
      value: "Britt",
      dim: false,
    });
    expect(rows).toContainEqual({
      kind: "block",
      label: "Premise",
      value: "A premise.",
      dim: false,
    });
  });

  it("summarises what the adventure contains, pluralised", () => {
    expect(renderConfigFields(adventure)).toContainEqual({
      kind: "list",
      label: "Contents",
      items: ["2 rooms", "1 item", "0 characters", "1 beat"],
    });
  });

  it("dims an unset author", () => {
    const bare: Adventure = {
      meta: { id: "a", title: "A", version: "1" },
      premise: "p",
      start: {},
    };
    const author = renderConfigFields(bare).find(
      (r) => r.kind === "scalar" && r.label === "Author",
    )!;
    expect(author).toMatchObject({ dim: true });
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
