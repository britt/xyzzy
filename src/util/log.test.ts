import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeError, log, logPath, userMessage } from "./log.js";

const savedState = process.env.XDG_STATE_HOME;

beforeEach(() => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-log-"));
});
afterEach(() => {
  if (savedState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedState;
  delete process.env.XYZZY_LOG;
});

function readLog(): Record<string, unknown>[] {
  return readFileSync(logPath(), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

describe("log", () => {
  it("appends JSON-line records with level, message, and time", () => {
    log.info("play started", { adventure: "cave" });
    const [rec] = readLog();
    expect(rec).toMatchObject({
      level: "info",
      message: "play started",
      detail: { adventure: "cave" },
    });
    expect(typeof rec!.time).toBe("string");
  });

  it("captures AI SDK error fields for diagnostics", () => {
    // Mimic an APICallError from the provider layer.
    const apiErr = Object.assign(new Error("Invalid JSON response"), {
      name: "AI_APICallError",
      statusCode: 200,
      url: "http://localhost:1234/v1/chat/completions",
      responseBody: "<html>Not Found</html>",
      cause: new Error("Unexpected token < in JSON"),
    });
    log.error("turn failed", apiErr);

    const [rec] = readLog();
    const detail = rec!.detail as Record<string, unknown>;
    expect(detail.message).toBe("Invalid JSON response");
    expect(detail.statusCode).toBe(200);
    expect(detail.responseBody).toBe("<html>Not Found</html>");
    expect(detail.cause).toMatchObject({ message: "Unexpected token < in JSON" });
  });

  it("is disabled by XYZZY_LOG=0", () => {
    process.env.XYZZY_LOG = "0";
    log.info("should not write");
    expect(() => readFileSync(logPath(), "utf8")).toThrow();
  });
});

describe("describeError", () => {
  it("handles non-Error values", () => {
    expect(describeError("boom")).toEqual({ value: "boom" });
  });
});

describe("userMessage", () => {
  it("enriches provider errors with status and cause", () => {
    const err = Object.assign(new Error("Invalid JSON response"), {
      statusCode: 200,
      cause: new Error("Unexpected token <"),
    });
    expect(userMessage(err)).toBe(
      "Invalid JSON response · HTTP 200 · Unexpected token <",
    );
  });

  it("falls back to the plain message", () => {
    expect(userMessage(new Error("nope"))).toBe("nope");
  });
});
