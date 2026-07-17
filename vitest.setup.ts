import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep any logs written during tests out of the real ~/.local/state.
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "xyzzy-test-state-"));
