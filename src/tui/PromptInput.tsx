import { useRef, useState } from "react";
import { Text, useInput } from "ink";

export interface PromptInputProps {
  /** command history, oldest → newest (recalled with Up/Down) */
  history: string[];
  /** called with the line when the player presses Enter */
  onSubmit: (value: string) => void;
  isActive?: boolean;
}

interface EditState {
  value: string;
  cursor: number;
  /** index into history while recalling; null while editing a fresh line */
  index: number | null;
  /** the in-progress line, preserved so Down can restore it */
  draft: string;
}

const EMPTY: EditState = { value: "", cursor: 0, index: null, draft: "" };

/**
 * A line editor with bash-style keybindings. Owns its value and cursor so it can
 * support cursor motion and kill commands that `ink-text-input` can't:
 *
 *   Enter        submit          ←/→        move cursor
 *   Up/Down      history         Ctrl-A/E   line start / end
 *   Backspace    delete before   Ctrl-U     delete to line start
 *   Ctrl-W       delete word     Ctrl-K     delete to line end
 *
 * Edits use functional state updates (reading the previous state), so the key
 * handler never depends on a stale closure. `history` and `onSubmit` are read
 * through refs for the same reason.
 */
export function PromptInput({ history, onSubmit, isActive = true }: PromptInputProps) {
  const [st, setSt] = useState<EditState>(EMPTY);
  const stRef = useRef(st);
  stRef.current = st;
  const historyRef = useRef(history);
  historyRef.current = history;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useInput(
    (input, key) => {
      if (key.return) {
        const value = stRef.current.value;
        setSt(EMPTY);
        onSubmitRef.current(value);
        return;
      }

      // --- history ---
      if (key.upArrow) {
        const hist = historyRef.current;
        if (hist.length === 0) return;
        setSt((s) => {
          if (s.index === null) {
            const i = hist.length - 1;
            return { value: hist[i]!, cursor: hist[i]!.length, index: i, draft: s.value };
          }
          if (s.index > 0) {
            const i = s.index - 1;
            return { ...s, value: hist[i]!, cursor: hist[i]!.length, index: i };
          }
          return s;
        });
        return;
      }
      if (key.downArrow) {
        const hist = historyRef.current;
        setSt((s) => {
          if (s.index === null) return s;
          if (s.index < hist.length - 1) {
            const i = s.index + 1;
            return { ...s, value: hist[i]!, cursor: hist[i]!.length, index: i };
          }
          return { ...s, value: s.draft, cursor: s.draft.length, index: null };
        });
        return;
      }

      // --- cursor motion ---
      if (key.leftArrow) {
        return setSt((s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }));
      }
      if (key.rightArrow) {
        return setSt((s) => ({ ...s, cursor: Math.min(s.value.length, s.cursor + 1) }));
      }
      if (key.ctrl && input === "a") return setSt((s) => ({ ...s, cursor: 0 }));
      if (key.ctrl && input === "e") {
        return setSt((s) => ({ ...s, cursor: s.value.length }));
      }

      // --- kill / delete ---
      if (key.ctrl && input === "u") {
        return setSt((s) => ({ ...s, value: s.value.slice(s.cursor), cursor: 0 }));
      }
      if (key.ctrl && input === "k") {
        return setSt((s) => ({ ...s, value: s.value.slice(0, s.cursor) }));
      }
      if (key.ctrl && input === "w") {
        return setSt((s) => {
          const left = s.value
            .slice(0, s.cursor)
            .replace(/\s+$/, "")
            .replace(/\S+$/, "");
          return { ...s, value: left + s.value.slice(s.cursor), cursor: left.length };
        });
      }
      if (key.backspace || key.delete) {
        return setSt((s) =>
          s.cursor === 0
            ? s
            : {
                ...s,
                value: s.value.slice(0, s.cursor - 1) + s.value.slice(s.cursor),
                cursor: s.cursor - 1,
              },
        );
      }

      // Ignore any other control/navigation keys (incl. Ctrl-C, handled by Ink).
      if (
        key.ctrl ||
        key.meta ||
        key.tab ||
        key.escape ||
        key.pageUp ||
        key.pageDown
      ) {
        return;
      }

      // --- printable insert (also handles multi-char pastes) ---
      if (input) {
        setSt((s) => ({
          ...s,
          value: s.value.slice(0, s.cursor) + input + s.value.slice(s.cursor),
          cursor: s.cursor + input.length,
        }));
      }
    },
    { isActive },
  );

  const { value, cursor } = st;
  const before = value.slice(0, cursor);
  const atCursor = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);

  return (
    <Text>
      {before}
      <Text inverse>{atCursor}</Text>
      {after}
    </Text>
  );
}
