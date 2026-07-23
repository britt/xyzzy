import { describe, expect, it } from "vitest";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("The Vault")).toBe("the-vault");
  });

  it("collapses runs of punctuation and whitespace to a single hyphen", () => {
    expect(slugify("Old   Coin!!")).toBe("old-coin");
  });

  it("trims leading/trailing whitespace and punctuation", () => {
    expect(slugify("  Grimble's Lair ")).toBe("grimbles-lair");
  });

  it("collapses multiple separators", () => {
    expect(slugify("a--b__c")).toBe("a-b-c");
  });

  it("passes already-slugged input through unchanged", () => {
    expect(slugify("cavern")).toBe("cavern");
  });
});
