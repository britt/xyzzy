import type { FieldRow } from "./renderFields.js";
import type {
  DetectorCallLog,
  NarratorCallLog,
  SessionHeader,
  SessionLogRecord,
} from "../../llm/sessionLog.js";

/**
 * Formats a parsed session log for the dev TUI's content pane, reusing the same
 * `FieldRow` shapes every other category emits — so the existing
 * `layoutFieldRows` → `ContentLine` pipeline (and its scrolling) renders a log
 * with no new UI code, and a log reads like the rest of the tool rather than as
 * a raw JSON dump.
 */

function renderHeader(header: SessionHeader): FieldRow[] {
  return [
    { kind: "heading", title: header.startedAt, subtitle: header.adventure },
    { kind: "scalar", label: "Source", value: header.source, dim: false },
    {
      kind: "scalar",
      label: "Provider",
      value: `${header.provider.kind} · ${header.provider.model}`,
      dim: false,
    },
    { kind: "scalar", label: "Save slot", value: header.saveSlot, dim: false },
    {
      kind: "scalar",
      label: "Resumed from",
      value: header.resumedFrom ?? "(new game)",
      dim: header.resumedFrom === null,
    },
  ];
}

const SOLID_RULE: FieldRow = { kind: "rule", style: "solid" };
const DOTTED_RULE: FieldRow = { kind: "rule", style: "dotted" };

/** e.g. `Narrator call 1 (12ms, ok)` — which call, how long, and whether it landed. */
function callLabel(role: string, index: number, ms: number, ok: boolean): string {
  return `${role} call ${index + 1} (${ms}ms, ${ok ? "ok" : "failed"})`;
}

/**
 * @param promptLabel label to render this call's system prompt under, or
 * `null` to omit it — it is constant for an adventure, so repeating it on
 * every turn buries the turn's own exchange. Shown once for the session, and
 * again only if it actually changes (which `xyzzy dev` allows: editing the
 * adventure mid-session rebuilds it).
 */
function renderNarratorCall(
  call: NarratorCallLog,
  index: number,
  promptLabel: string | null,
): FieldRow[] {
  const base: FieldRow[] = [
    {
      kind: "scalar",
      label: callLabel("Narrator", index, call.ms, call.ok),
      value: "",
      dim: false,
    },
    ...(promptLabel === null
      ? []
      : ([
          {
            kind: "block",
            label: promptLabel,
            value: call.context.systemPrompt,
            dim: false,
          },
        ] as FieldRow[])),
    { kind: "block", label: "Digest", value: call.context.digest, dim: false },
  ];
  if (call.ok) {
    return [
      ...base,
      { kind: "block", label: "Narration", value: call.result.narration, dim: false },
      {
        kind: "list",
        label: "Actions",
        items: call.result.actions.map((a) => JSON.stringify(a)),
      },
    ];
  }
  return [
    ...base,
    { kind: "block", label: "Error", value: JSON.stringify(call.error), dim: false },
  ];
}

function renderDetectorCall(call: DetectorCallLog, index: number): FieldRow[] {
  const base: FieldRow[] = [
    {
      kind: "scalar",
      label: callLabel("Detector", index, call.ms, call.ok),
      value: "",
      dim: false,
    },
  ];
  return call.ok
    ? [
        ...base,
        {
          kind: "block",
          label: "Detection",
          value: JSON.stringify(call.result),
          dim: false,
        },
      ]
    : [
        ...base,
        { kind: "block", label: "Error", value: JSON.stringify(call.error), dim: false },
      ];
}

/** The system prompt the session opened with, if it made any narrator call. */
function firstSystemPrompt(records: SessionLogRecord[]): string | undefined {
  for (const record of records) {
    if (record.type !== "session" && record.narrator.length > 0) {
      return record.narrator[0]!.context.systemPrompt;
    }
  }
  return undefined;
}

export function renderSessionLogFields(records: SessionLogRecord[]): FieldRow[] {
  const rows: FieldRow[] = [];
  const sessionPrompt = firstSystemPrompt(records);
  // The prompt currently on screen, so a turn only re-prints it when it differs.
  let shownPrompt: string | undefined;

  for (const record of records) {
    if (record.type === "session") {
      rows.push(...renderHeader(record));
      if (sessionPrompt !== undefined) {
        rows.push({
          kind: "block",
          label: "System prompt",
          value: sessionPrompt,
          dim: false,
        });
        shownPrompt = sessionPrompt;
      }
      continue;
    }

    // A solid rule opens each turn, so the big units of the log are obvious
    // when scrolling; the exchanges inside one are separated by dotted rules.
    rows.push(SOLID_RULE);
    rows.push({ kind: "heading", title: `Turn ${record.turn}` });
    rows.push({ kind: "block", label: "Input", value: record.input, dim: false });

    // Detection runs before narration, so the rows read in the order it ran.
    record.detector.forEach((call, i) => {
      rows.push(DOTTED_RULE);
      rows.push(...renderDetectorCall(call, i));
    });
    record.narrator.forEach((call, i) => {
      rows.push(DOTTED_RULE);
      const promptLabel =
        shownPrompt === undefined
          ? "System prompt"
          : call.context.systemPrompt !== shownPrompt
            ? "System prompt (changed)"
            : null;
      rows.push(...renderNarratorCall(call, i, promptLabel));
      if (promptLabel !== null) shownPrompt = call.context.systemPrompt;
    });
  }
  return rows;
}
