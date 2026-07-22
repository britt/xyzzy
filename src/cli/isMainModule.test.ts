import { describe, expect, it } from "vitest";
import { isMainModule } from "./isMainModule.js";

describe("isMainModule", () => {
  it("returns true when the module URL matches the resolved script path", () => {
    expect(
      isMainModule(
        "file:///real/dist/cli/index.js",
        "/real/dist/cli/index.js",
      ),
    ).toBe(true);
  });

  it("returns false when the resolved script path points elsewhere (e.g. imported in a test)", () => {
    expect(
      isMainModule("file:///real/dist/cli/index.js", "/real/dist/other.js"),
    ).toBe(false);
  });

  it("returns true even when argv[1] was a symlink resolved to the real path", () => {
    // npm's global bin install is a symlink (e.g. prefix/bin/xyzzy) pointing at
    // the real dist file; the caller is expected to pass the *resolved* real
    // path here, which is exactly what should still compare equal.
    expect(
      isMainModule(
        "file:///private/prefix/lib/node_modules/pkg/dist/cli/index.js",
        "/private/prefix/lib/node_modules/pkg/dist/cli/index.js",
      ),
    ).toBe(true);
  });

  it("handles paths with spaces correctly", () => {
    expect(
      isMainModule(
        "file:///Users/dev/my%20project/dist/cli/index.js",
        "/Users/dev/my project/dist/cli/index.js",
      ),
    ).toBe(true);
  });
});
