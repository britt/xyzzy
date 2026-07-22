import {
  mkdtempSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeRealpath } from "./safeRealpath.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xyzzy-realpath-"));
}

describe("safeRealpath", () => {
  it("returns the realpath of a file that exists", () => {
    const dir = tmp();
    const file = join(dir, "script.js");
    writeFileSync(file, "");

    expect(safeRealpath(file)).toBe(realpathSync(file));
  });

  it("returns undefined for a path that does not exist", () => {
    const dir = tmp();
    const missing = join(dir, "does-not-exist.js");

    expect(safeRealpath(missing)).toBeUndefined();
  });

  it("returns undefined for a broken symlink (dangling npm bin install)", () => {
    const dir = tmp();
    const target = join(dir, "target.js");
    const link = join(dir, "xyzzy");
    writeFileSync(target, "");
    symlinkSync(target, link);
    unlinkSync(target);

    expect(safeRealpath(link)).toBeUndefined();
  });
});
