import { spawnSync } from "node:child_process";

/**
 * Launching the user's editor is deliberately conservative: `$VISUAL`/`$EDITOR`
 * are a *command line*, not a bare program name, so `EDITOR="code --wait"` has
 * to work. GUI editors return immediately unless told to wait, which is why the
 * flag has to survive into the spawn rather than being stripped.
 */

export interface EditorCommand {
  command: string;
  args: string[];
}

/**
 * Split an editor spec into a command and its arguments, honouring simple
 * single/double quoting so a program path containing spaces stays one token.
 */
export function parseEditorCommand(spec: string): EditorCommand {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of spec) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);

  const [command = "", ...args] = tokens;
  return { command, args };
}

/**
 * The editor command line to use. `VISUAL` wins over `EDITOR` per POSIX
 * convention, and an empty value counts as unset rather than as a command.
 */
export function resolveEditorSpec(env: {
  VISUAL?: string | undefined;
  EDITOR?: string | undefined;
}): string {
  return env.VISUAL || env.EDITOR || "vi";
}

/** Minimal shape of `spawnSync`'s result that we actually depend on. */
interface SpawnResult {
  error?: Error;
  status?: number | null;
}

export interface OpenInEditorOptions {
  env?: { VISUAL?: string | undefined; EDITOR?: string | undefined };
  spawn?: (
    command: string,
    args: string[],
    options: { stdio: "inherit" },
  ) => SpawnResult;
}

/**
 * Open `path` in the user's editor and block until it exits, handing the
 * terminal over for the duration. A non-zero exit is not an error — aborting
 * an edit (`:cq`) is a legitimate outcome — but a failure to launch is, since
 * silently doing nothing is indistinguishable from a broken keybinding.
 */
export function openInEditor(path: string, options: OpenInEditorOptions = {}): void {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? spawnSync;
  const spec = resolveEditorSpec(env);
  const { command, args } = parseEditorCommand(spec);

  const result = spawn(command, [...args, path], { stdio: "inherit" });
  if (result.error) {
    throw new Error(
      `Could not launch editor "${spec}": ${result.error.message}. ` +
        "Set $EDITOR or $VISUAL to a command on your PATH — and for a GUI " +
        'editor include its wait flag (e.g. EDITOR="code --wait").',
    );
  }
}
