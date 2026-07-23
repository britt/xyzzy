#!/usr/bin/env node
import { Command } from "commander";
import { log } from "../util/log.js";
import { isMainModule } from "./isMainModule.js";
import { safeRealpath } from "./safeRealpath.js";
import { play } from "./commands/play.js";
import { newAdventure } from "./commands/new.js";
import { newEntity } from "./commands/newEntity.js";
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

  const newCmd = program
    .command("new")
    .argument("<name>", "adventure name / target directory")
    .description("scaffold a new adventure")
    .action((name: string) => newAdventure(name));

  newCmd
    .command("room")
    .argument("<name>", "room name")
    .option("--adventure <path>", "adventure directory", process.cwd())
    .option("--id <id>", "override the generated id")
    .option("--description <text>", "room description")
    .option(
      "--non-interactive",
      "never prompt; leave unset fields as placeholders",
    )
    .description("create a new room")
    .action(
      (
        name: string,
        opts: {
          adventure: string;
          id?: string;
          description?: string;
          nonInteractive?: boolean;
        },
      ) =>
        newEntity({
          kind: "room",
          positional: name,
          adventure: opts.adventure,
          id: opts.id,
          description: opts.description,
          nonInteractive: opts.nonInteractive,
        }),
    );

  newCmd
    .command("item")
    .argument("<name>", "item name")
    .option("--adventure <path>", "adventure directory", process.cwd())
    .option("--id <id>", "override the generated id")
    .option("--description <text>", "item description")
    .option("--location <id>", "starting room or character id")
    .option(
      "--non-interactive",
      "never prompt; leave unset fields as placeholders",
    )
    .description("create a new item")
    .action(
      (
        name: string,
        opts: {
          adventure: string;
          id?: string;
          description?: string;
          location?: string;
          nonInteractive?: boolean;
        },
      ) =>
        newEntity({
          kind: "item",
          positional: name,
          adventure: opts.adventure,
          id: opts.id,
          description: opts.description,
          location: opts.location,
          nonInteractive: opts.nonInteractive,
        }),
    );

  newCmd
    .command("character")
    .argument("<name>", "character name")
    .option("--adventure <path>", "adventure directory", process.cwd())
    .option("--id <id>", "override the generated id")
    .option("--persona <text>", "character persona")
    .option("--location <id>", "starting room id")
    .option(
      "--non-interactive",
      "never prompt; leave unset fields as placeholders",
    )
    .description("create a new character")
    .action(
      (
        name: string,
        opts: {
          adventure: string;
          id?: string;
          persona?: string;
          location?: string;
          nonInteractive?: boolean;
        },
      ) =>
        newEntity({
          kind: "character",
          positional: name,
          adventure: opts.adventure,
          id: opts.id,
          persona: opts.persona,
          location: opts.location,
          nonInteractive: opts.nonInteractive,
        }),
    );

  newCmd
    .command("beat")
    .argument("<id>", "beat id")
    .option("--adventure <path>", "adventure directory", process.cwd())
    .option("--description <text>", "what happens")
    .option("--trigger <text>", "trigger notes surfaced to the model")
    .option(
      "--non-interactive",
      "never prompt; leave unset fields as placeholders",
    )
    .description("create a new story beat")
    .action(
      (
        id: string,
        opts: {
          adventure: string;
          description?: string;
          trigger?: string;
          nonInteractive?: boolean;
        },
      ) =>
        newEntity({
          kind: "beat",
          positional: id,
          adventure: opts.adventure,
          description: opts.description,
          trigger: opts.trigger,
          nonInteractive: opts.nonInteractive,
        }),
    );

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
// matches and the installed CLI silently does nothing. safeRealpath returns
// undefined (rather than throwing) for a dangling symlink so a broken
// install fails closed instead of crashing on module load.
const resolvedScriptPath = process.argv[1]
  ? safeRealpath(process.argv[1])
  : undefined;
if (resolvedScriptPath && isMainModule(import.meta.url, resolvedScriptPath)) {
  main().catch((err) => {
    log.error("command failed", err);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
