import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Adventure, Character, Item, Room, StoryBeat } from "../world/schema.js";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  entriesForCategory,
  type CatalogEntry,
  type Category,
} from "./dev/entityCatalog.js";
import { renderConfigFields, renderFieldsFor, type FieldRow } from "./dev/renderFields.js";

export interface DevAppProps {
  adventure: Adventure;
  adventureDir: string;
}

type SelectionByCategory = Record<Category, number>;

const INITIAL_SELECTION: SelectionByCategory = {
  config: 0,
  beats: 0,
  characters: 0,
  rooms: 0,
  items: 0,
};

function findEntity(
  adventure: Adventure,
  entry: CatalogEntry,
): Room | Item | Character | StoryBeat | undefined {
  switch (entry.kind) {
    case "room":
      return adventure.entities?.rooms?.find((r) => r.id === entry.id);
    case "item":
      return adventure.entities?.items?.find((i) => i.id === entry.id);
    case "character":
      return adventure.entities?.characters?.find((c) => c.id === entry.id);
    case "beat":
      return adventure.beats?.find((b) => b.id === entry.id);
  }
}

/**
 * The `xyzzy dev` browsing screen: a fixed category sidebar with the selected
 * category's entities beneath it, and a content pane showing the selected
 * entity's fields rendered as labelled rows (never raw YAML).
 */
export function DevApp({ adventure, adventureDir: _adventureDir }: DevAppProps) {
  const [category, setCategory] = useState<Category>("config");
  const [selection, setSelection] = useState<SelectionByCategory>(INITIAL_SELECTION);

  const entries = entriesForCategory(adventure, category);
  const index = entries.length === 0 ? 0 : Math.min(selection[category], entries.length - 1);

  useInput((_input, key) => {
    if (key.tab) {
      const step = key.shift ? -1 : 1;
      const i = CATEGORIES.indexOf(category);
      setCategory(CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!);
      return;
    }
    if (key.downArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.min(entries.length - 1, index + 1) }));
      return;
    }
    if (key.upArrow && entries.length > 0) {
      setSelection((s) => ({ ...s, [category]: Math.max(0, index - 1) }));
      return;
    }
  });

  const fieldRows: FieldRow[] =
    category === "config"
      ? renderConfigFields(adventure)
      : (() => {
          const entry = entries[index];
          if (!entry) return [];
          const entity = findEntity(adventure, entry);
          return entity ? renderFieldsFor(category, entity) : [];
        })();

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={26} marginRight={2}>
        {CATEGORIES.map((c) => (
          <Text key={c} inverse={c === category}>
            {CATEGORY_LABELS[c]}
          </Text>
        ))}
        <Text> </Text>
        {entries.map((e, i) => (
          <Text key={`${e.kind}:${e.id}`} inverse={i === index}>
            {"  " + e.label}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {fieldRows.map((row) => (
          <Text key={row.label} dimColor={row.dim}>
            {row.label}: {row.value}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
