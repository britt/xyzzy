import { describe, expect, it } from "vitest";
import { resolvePackageJsonPath } from "./resolvePackageJsonPath.js";

describe("resolvePackageJsonPath", () => {
  it("resolves the package root's package.json from the built dist entry point", () => {
    expect(resolvePackageJsonPath("file:///real/dist/cli/index.js")).toBe(
      "/real/package.json",
    );
  });

  it("resolves the package root's package.json from the dev src entry point", () => {
    expect(resolvePackageJsonPath("file:///real/src/cli/index.ts")).toBe(
      "/real/package.json",
    );
  });

  it("handles paths with spaces correctly", () => {
    expect(
      resolvePackageJsonPath("file:///Users/dev/my%20project/dist/cli/index.js"),
    ).toBe("/Users/dev/my project/package.json");
  });
});
