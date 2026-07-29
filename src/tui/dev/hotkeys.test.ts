import { describe, expect, it } from "vitest";
import { hotKeysFor, type HotKeyContext } from "./hotkeys.js";

const sidebar: HotKeyContext = {
  focus: "sidebar",
  submenuOpen: false,
  entryCount: 0,
  isConfigCategory: true,
  isLogsCategory: false,
  hasLiveSession: false,
  canPlay: true,
};

const keys = (ctx: HotKeyContext) => hotKeysFor(ctx).map((h) => h.key);
const labelFor = (ctx: HotKeyContext, key: string) =>
  hotKeysFor(ctx).find((h) => h.key === key)?.label;

describe("hotKeysFor", () => {
  describe("play submenu", () => {
    const ctx = { ...sidebar, submenuOpen: true };

    it("offers only the submenu's own keys", () => {
      expect(keys(ctx)).toEqual(["↑↓", "Enter", "Esc"]);
    });

    it("hides keys the submenu swallows", () => {
      // While the submenu is open every other key is consumed by it.
      expect(keys(ctx)).not.toContain("Tab");
      expect(keys(ctx)).not.toContain("e");
      expect(keys(ctx)).not.toContain("q");
    });
  });

  describe("play focus", () => {
    const ctx = { ...sidebar, focus: "play" as const, hasLiveSession: true };

    it("offers only Escape, since every other key goes to the game", () => {
      expect(keys(ctx)).toEqual(["Esc"]);
    });
  });

  describe("sidebar focus", () => {
    it("offers category switching, edit, play and quit on the config category", () => {
      expect(keys(sidebar)).toEqual(["Tab", "e", "p", "q"]);
    });

    it("offers entity navigation when a category has more than one entry", () => {
      const ctx = { ...sidebar, isConfigCategory: false, entryCount: 3 };
      expect(keys(ctx)).toEqual(["Tab", "↑↓", "e", "p", "q"]);
    });

    it("hides entity navigation when a single entry makes it a no-op", () => {
      const ctx = { ...sidebar, isConfigCategory: false, entryCount: 1 };
      expect(keys(ctx)).not.toContain("↑↓");
      expect(keys(ctx)).toContain("e");
    });

    it("hides edit in an empty category, where there is nothing selected to edit", () => {
      const ctx = { ...sidebar, isConfigCategory: false, entryCount: 0 };
      expect(keys(ctx)).not.toContain("e");
      expect(keys(ctx)).not.toContain("↑↓");
      expect(keys(ctx)).toEqual(["Tab", "p", "q"]);
    });

    it("hides play when no provider is configured to start a session with", () => {
      expect(keys({ ...sidebar, canPlay: false })).not.toContain("p");
    });

    it("labels play as Resume once a session is live", () => {
      expect(labelFor(sidebar, "p")).toBe("Play");
      expect(labelFor({ ...sidebar, hasLiveSession: true }, "p")).toBe("Resume");
    });

    it("gives every key a non-empty label", () => {
      for (const hotkey of hotKeysFor({ ...sidebar, isConfigCategory: false, entryCount: 3 })) {
        expect(hotkey.label).toBeTruthy();
      }
    });
  });
});

describe("hotKeysFor content scrolling", () => {
  it("offers the scroll keys only when the pane overflows", () => {
    expect(keys(sidebar)).not.toContain("PgUp/PgDn");
    expect(keys({ ...sidebar, canScrollContent: true })).toContain("PgUp/PgDn");
  });

  it("does not offer them while the submenu or a play session owns the keyboard", () => {
    expect(keys({ ...sidebar, submenuOpen: true, canScrollContent: true })).not.toContain(
      "PgUp/PgDn",
    );
    expect(
      keys({ ...sidebar, focus: "play", canScrollContent: true }),
    ).not.toContain("PgUp/PgDn");
  });
});

describe("hotKeysFor logs category", () => {
  const logs: HotKeyContext = {
    ...sidebar,
    entryCount: 3,
    isConfigCategory: false,
    isLogsCategory: true,
    canPlay: false,
  };

  it("omits the Edit key for the logs category, even with entries selected", () => {
    expect(keys(logs)).not.toContain("e");
  });

  it("still offers navigation for the logs category", () => {
    // Up/down scroll the log here, so moving between sessions is left/right.
    expect(keys(logs)).toContain("←→");
  });

  it("omits Edit for an empty logs category too", () => {
    expect(keys({ ...logs, entryCount: 0 })).not.toContain("e");
  });
});

describe("hotKeysFor logs navigation", () => {
  const logs: HotKeyContext = {
    ...sidebar,
    entryCount: 3,
    isConfigCategory: false,
    isLogsCategory: true,
    canPlay: false,
  };

  it("labels up/down as Scroll, not Entity, when the log overflows", () => {
    const ctx = { ...logs, canScrollContent: true };
    expect(labelFor(ctx, "↑↓")).toBe("Scroll");
  });

  it("offers left/right to move between sessions", () => {
    expect(labelFor(logs, "←→")).toBe("Session");
  });

  it("omits the session key when there is only one log", () => {
    expect(keys({ ...logs, entryCount: 1 })).not.toContain("←→");
  });

  it("omits up/down entirely when the log fits on screen", () => {
    expect(keys({ ...logs, canScrollContent: false })).not.toContain("↑↓");
  });

  it("still offers PgUp/PgDn, relabelled as Page", () => {
    const ctx = { ...logs, canScrollContent: true };
    expect(labelFor(ctx, "PgUp/PgDn")).toBe("Page");
  });

  it("leaves entity categories on the old up/down-selects model", () => {
    const rooms = { ...logs, isLogsCategory: false, canScrollContent: true };
    expect(labelFor(rooms, "↑↓")).toBe("Entity");
    expect(labelFor(rooms, "PgUp/PgDn")).toBe("Scroll");
    expect(keys(rooms)).not.toContain("←→");
  });
});
