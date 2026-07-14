import { notImplemented } from "../../util/notImplemented.js";

/** `config list` — print configured providers and the default. */
export async function configList(): Promise<void> {
  return notImplemented("cli/commands/config.list");
}

/** `config add` — add a provider (base URL, model, kind) to the global store. */
export async function configAdd(): Promise<void> {
  return notImplemented("cli/commands/config.add");
}

/** `config use <name>` — set the default provider. */
export async function configUse(_name: string): Promise<void> {
  return notImplemented("cli/commands/config.use");
}

/** `config test` — ping the configured endpoint. */
export async function configTest(): Promise<void> {
  return notImplemented("cli/commands/config.test");
}
