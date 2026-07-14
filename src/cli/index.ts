#!/usr/bin/env node
import { Command } from "commander";
import { play } from "./commands/play.js";
import { newAdventure } from "./commands/new.js";
import { validate } from "./commands/validate.js";
import {
  configAdd,
  configList,
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

  const config = program
    .command("config")
    .description("manage LLM providers");
  config.command("list").action(configList);
  config.command("add").action(configAdd);
  config
    .command("use")
    .argument("<name>", "provider name")
    .action((name: string) => configUse(name));
  config.command("test").action(configTest);

  return program;
}

async function main(): Promise<void> {
  await buildProgram().parseAsync(process.argv);
}

// Only auto-run when invoked as the CLI, not when imported in tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
