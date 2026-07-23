import { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import TextInput from "ink-text-input";

export interface FormFieldSpec {
  key: string;
  label: string;
  /** pre-filled, editable; Enter with no edits accepts it as-is. */
  defaultValue?: string;
}

export interface EntityFormProps {
  fields: FormFieldSpec[];
  onDone: (answers: Record<string, string | undefined>) => void;
}

/**
 * Prompts one field at a time. Enter on a field with no default and an
 * empty value records `undefined` (skip); otherwise records the submitted
 * value. Calls `onDone` once, after the last field (or immediately, for an
 * empty `fields` list).
 */
export function EntityForm({ fields, onDone }: EntityFormProps) {
  const answers = useRef<Record<string, string | undefined>>({});
  const [index, setIndex] = useState(0);
  const field = fields[index];
  const [value, setValue] = useState(field?.defaultValue ?? "");

  // Mount-once: fires only for the empty-fields case, exactly once,
  // regardless of whether the parent re-renders with fresh `fields`/`onDone`
  // identities (an empty dependency array intentionally ignores changes to
  // either after mount — this isn't a stale-closure bug, it's the point).
  useEffect(() => {
    if (fields.length === 0) onDone({});
  }, []);

  if (!field) return null;

  function handleSubmit(submitted: string) {
    const answer =
      field!.defaultValue === undefined && submitted === ""
        ? undefined
        : submitted;
    answers.current = { ...answers.current, [field!.key]: answer };

    const nextIndex = index + 1;
    if (nextIndex >= fields.length) {
      onDone(answers.current);
      setIndex(nextIndex);
      return;
    }
    setValue(fields[nextIndex]?.defaultValue ?? "");
    setIndex(nextIndex);
  }

  const hint = field.defaultValue === undefined ? " (Enter to skip)" : "";
  return (
    <Text>
      {field.label}
      {hint}: <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Text>
  );
}
