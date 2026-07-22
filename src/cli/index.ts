#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { Command } from "commander";
import { log } from "../util/log.js";
import { isMainModule } from "./isMainModule.js";
import { play } from "./commands/play.js";
import { newAdventure } from "./commands/new.js";
import { validate } from "./commands/validate.js";
import { map } from "./commands/map.js";
import {
  configAdd,
  configList,
  configModels,
  configTest,
  configUse,
} from "./commands/config.js";

/**
 * Thin commander entrypoint: parse args, delegate to a lib function. No game
 * logic lives here.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("xyzzy")
    .description("Build and play text adventures with local LLMs.")
    .version("0.0.0");

  program
    .command("play")
    .argument("<path>", "adventure directory")
    .option("--save <slot>", "resume a specific save slot")
    .option("--provider <name>", "provider to use for this session")
    .description("launch the play TUI")
    .action((path: string, opts: { save?: string; provider?: string }) =>
      play(path, opts),
    );

  program
    .command("new")
    .argument("<name>", "adventure name / target directory")
    .description("scaffold a new adventure")
    .action((name: string) => newAdventure(name));

  program
    .command("validate")
    .argument("<path>", "adventure directory")
    .description("validate an adventure against the schema (CI-friendly)")
    .action(async (path: string) => {
      process.exitCode = await validate(path);
    });

  program
    .command("map")
    .argument("<path>", "adventure directory")
    .description("compute the room layout and save it to map.yaml in the adventure directory")
    .action((path: string) => map(path));

  const config = program
    .command("config")
    .description("manage LLM providers");
  config.command("list").action(configList);
  config
    .command("add")
    .argument("<name>", "provider name")
    .requiredOption("--model <model>", "model id")
    .option(
      "--kind <kind>",
      "provider kind (openai-compatible|lmstudio|ollama|openai|anthropic)",
      "openai-compatible",
    )
    .option("--base-url <url>", "endpoint base URL")
    .option("--api-key-env <var>", "env var holding the API key")
    .action(
      (
        name: string,
        opts: { model: string; kind: string; baseUrl?: string; apiKeyEnv?: string },
      ) =>
        configAdd(name, {
          model: opts.model,
          kind: opts.kind,
          baseUrl: opts.baseUrl,
          apiKeyEnv: opts.apiKeyEnv,
        }),
    );
  config
    .command("use")
    .argument("<name>", "provider name")
    .action((name: string) => configUse(name));
  config
    .command("test")
    .argument("[name]", "provider to ping (defaults to the configured default)")
    .action((name?: string) => configTest(name));
  config
    .command("models")
    .argument("[name]", "provider to query (defaults to the configured default)")
    .description("list the models the provider's endpoint reports")
    .action((name?: string) => configModels(name));

  return program;
}

async function main(): Promise<void> {
  await buildProgram().parseAsync(process.argv);
}

// Only auto-run when invoked as the CLI, not when imported in tests.
// process.argv[1] must be realpath-resolved because import.meta.url is
// resolved through symlinks by Node, but argv[1] is not — npm's global
// `bin` install is always a symlink, so without this the comparison never
// matches and the installed CLI silently does nothing.
if (process.argv[1] && isMainModule(import.meta.url, realpathSync(process.argv[1]))) {
  main().catch((err) => {
    log.error("command failed", err);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
