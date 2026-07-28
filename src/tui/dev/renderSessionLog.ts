import type { FieldRow } from "./renderFields.js";
import type {
  DetectorCallLog,
  NarratorCallLog,
  SessionHeader,
  SessionLogRecord,
  TurnRecord,
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

/** e.g. `Narrator call 1 (12ms, ok)` — which call, how long, and whether it landed. */
function callLabel(role: string, index: number, ms: number, ok: boolean): string {
  return `${role} call ${index + 1} (${ms}ms, ${ok ? "ok" : "failed"})`;
}

function renderNarratorCall(call: NarratorCallLog, index: number): FieldRow[] {
  const base: FieldRow[] = [
    {
      kind: "scalar",
      label: callLabel("Narrator", index, call.ms, call.ok),
      value: "",
      dim: false,
    },
    {
      kind: "block",
      label: "System prompt",
      value: call.context.systemPrompt,
      dim: false,
    },
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

/** Detection runs before narration, so the rows read in the order the turn ran. */
function renderTurn(turn: TurnRecord<DetectorCallLog, NarratorCallLog>): FieldRow[] {
  const rows: FieldRow[] = [
    { kind: "heading", title: `Turn ${turn.turn}` },
    { kind: "block", label: "Input", value: turn.input, dim: false },
  ];
  turn.detector.forEach((call, i) => rows.push(...renderDetectorCall(call, i)));
  turn.narrator.forEach((call, i) => rows.push(...renderNarratorCall(call, i)));
  return rows;
}

export function renderSessionLogFields(records: SessionLogRecord[]): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const record of records) {
    rows.push(...(record.type === "session" ? renderHeader(record) : renderTurn(record)));
  }
  return rows;
}
