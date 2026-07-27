import { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  Adventure as AdventureSchema,
  type Adventure,
  type Character,
  type Item,
  type Room,
  type StoryBeat,
} from "../world/schema.js";
import { readAdventureFile, resolveAdventureFile } from "../world/loader.js";
import { formatIssues, validateAdventure, type ValidationIssue } from "../world/validator.js";
import { entityFilePath, type EntityKind } from "../world/entityWriter.js";
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
  /** injected for testability; defaults to a real $EDITOR spawn in dev.ts. */
  openEditor?: (path: string) => void;
}

type SelectionByCategory = Record<Category, number>;

/** Issue-map key for the adventure's own config, which has no (kind, id). */
const CONFIG_KEY = "config";

function entityKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

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
export function DevApp({
  adventure: initialAdventure,
  adventureDir,
  openEditor,
}: DevAppProps) {
  const [category, setCategory] = useState<Category>("config");
  const [selection, setSelection] = useState<SelectionByCategory>(INITIAL_SELECTION);
  const [adventure, setAdventure] = useState(initialAdventure);
  const [issues, setIssues] = useState<Record<string, ValidationIssue[]>>({});

  const entries = entriesForCategory(adventure, category);
  const index = entries.length === 0 ? 0 : Math.min(selection[category], entries.length - 1);
  const currentEntry = category === "config" ? undefined : entries[index];
  const currentKey =
    category === "config"
      ? CONFIG_KEY
      : currentEntry
        ? entityKey(currentEntry.kind, currentEntry.id)
        : undefined;

  /**
   * Open the selected entity's file in the editor, then reload and re-validate
   * the whole adventure. On failure the previous good `adventure` is kept (so
   * every other entity stays browsable) and the issues are attributed to the
   * entity that was just edited.
   */
  function editSelected() {
    const path =
      category === "config"
        ? resolveAdventureFile(adventureDir)
        : currentEntry
          ? entityFilePath(adventureDir, currentEntry.kind, currentEntry.id)
          : undefined;
    if (!path || !currentKey) return;

    openEditor?.(path);

    // A syntax error in what the editor saved makes readAdventureFile throw;
    // that must surface in the banner like any other problem, not tear down
    // the tool from inside a key handler.
    let result;
    let reloaded: unknown;
    try {
      reloaded = readAdventureFile(adventureDir);
      result = validateAdventure(reloaded);
    } catch (err) {
      result = {
        ok: false,
        issues: [
          { path: "(file)", message: err instanceof Error ? err.message : String(err) },
        ],
      };
    }

    if (result.ok) {
      setAdventure(AdventureSchema.parse(reloaded));
      setIssues((prev) => {
        if (!(currentKey in prev)) return prev;
        const next = { ...prev };
        delete next[currentKey];
        return next;
      });
    } else {
      setIssues((prev) => ({ ...prev, [currentKey]: result.issues }));
    }
  }

  useInput((input, key) => {
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
    if (input === "e") {
      editSelected();
      return;
    }
  });

  const currentIssues = currentKey ? issues[currentKey] : undefined;

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
            {issues[entityKey(e.kind, e.id)] ? "  ⚠" : ""}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {currentIssues ? (
          <>
            <Text color="red">⚠ Validation failed:</Text>
            <Text color="red">{formatIssues(currentIssues)}</Text>
          </>
        ) : (
          fieldRows.map((row) => (
            <Text key={row.label} dimColor={row.dim}>
              {row.label}: {row.value}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
