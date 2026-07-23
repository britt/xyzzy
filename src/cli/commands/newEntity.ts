import { relative } from "node:path";
import { createElement } from "react";
import { slugify } from "../../util/slug.js";
import {
  ENTITY_FIELDS,
  writeEntityFile,
  type EntityKind,
} from "../../world/entityWriter.js";
import type { FormFieldSpec } from "../forms/EntityForm.js";

export interface NewEntityOptions {
  kind: EntityKind;
  /** name for room/item/character; id for beat */
  positional: string;
  /** defaults to process.cwd() */
  adventure?: string;
  /** room/item/character only */
  id?: string;
  description?: string;
  location?: string;
  persona?: string;
  trigger?: string;
  nonInteractive?: boolean;
}

/** Render `EntityForm` for the given fields and resolve with the answers once done. */
async function promptRemainingFields(
  fields: FormFieldSpec[],
): Promise<Record<string, string | undefined>> {
  const [{ render }, { EntityForm }] = await Promise.all([
    import("ink"),
    import("../forms/EntityForm.js"),
  ]);
  return new Promise((resolve) => {
    const { unmount } = render(
      createElement(EntityForm, {
        fields,
        onDone: (answers: Record<string, string | undefined>) => {
          resolve(answers);
          unmount();
        },
      }),
    );
  });
}

/**
 * Create a new entity file: resolve id/name from the positional and flags,
 * prompt interactively for any remaining scalar field (unless
 * non-interactive or stdin isn't a TTY, in which case they're left as
 * placeholders), then write via `writeEntityFile`.
 */
export async function newEntity(opts: NewEntityOptions): Promise<void> {
  const adventureDir = opts.adventure ?? process.cwd();
  const id =
    opts.kind === "beat" ? opts.positional : (opts.id ?? slugify(opts.positional));
  const name = opts.kind === "beat" ? undefined : opts.positional;

  const flagValues: Record<string, string | undefined> = {
    description: opts.description,
    location: opts.location,
    persona: opts.persona,
    trigger: opts.trigger,
  };

  const values: Record<string, string | undefined> = {};
  const remaining: FormFieldSpec[] = [];
  for (const field of ENTITY_FIELDS[opts.kind]) {
    const flagValue = flagValues[field.key];
    if (flagValue !== undefined) {
      values[field.key] = flagValue;
    } else {
      remaining.push({ key: field.key, label: field.label });
    }
  }

  const interactive = Boolean(process.stdin.isTTY) && !opts.nonInteractive;
  if (remaining.length > 0 && interactive) {
    Object.assign(values, await promptRemainingFields(remaining));
  }

  const { path } = writeEntityFile(adventureDir, {
    kind: opts.kind,
    id,
    name,
    values,
  });

  console.log(`Wrote ${relative(adventureDir, path)}`);
  const placeholders = ENTITY_FIELDS[opts.kind].filter(
    (field) => values[field.key] === undefined,
  );
  if (placeholders.length > 0) {
    console.log(
      `Left ${placeholders.length} field(s) as commented placeholders — fill them in offline when ready.`,
    );
  }
}
