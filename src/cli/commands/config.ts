import { ProviderConfig } from "../../config/schema.js";
import { readGlobalConfig, writeGlobalConfig } from "../../config/store.js";
import { resolveProvider } from "../../config/resolve.js";
import { listModels } from "../../llm/registry.js";

function describe(p: ProviderConfig): string {
  const key = p.apiKeyEnv ? ` · key $${p.apiKeyEnv}` : "";
  return `${p.kind} · ${p.baseURL ?? "(default endpoint)"} · model "${p.model}"${key}`;
}

/** `config list` — print configured providers and the default. */
export async function configList(): Promise<void> {
  const config = await readGlobalConfig();
  const names = Object.keys(config.providers);
  if (names.length === 0) {
    console.log(
      "No providers configured. Add one with `xyzzy config add <name> --model <model>`.",
    );
    return;
  }
  for (const name of names) {
    const marker = name === config.default ? "*" : " ";
    console.log(`${marker} ${name}  ${describe(config.providers[name]!)}`);
  }
  if (!config.default) {
    console.log("\nNo default set. Choose one with `xyzzy config use <name>`.");
  }
}

export interface ConfigAddOptions {
  kind?: string;
  baseUrl?: string;
  model?: string;
  apiKeyEnv?: string;
}

/** `config add` — add (or replace) a named provider in the global store. */
export async function configAdd(
  name: string,
  opts: ConfigAddOptions,
): Promise<void> {
  if (!opts.model) {
    throw new Error("A model is required: pass --model <model>.");
  }
  const provider = ProviderConfig.parse({
    kind: opts.kind ?? "openai-compatible",
    baseURL: opts.baseUrl,
    model: opts.model,
    apiKeyEnv: opts.apiKeyEnv,
  });

  const config = await readGlobalConfig();
  const isFirst = config.default === undefined;
  await writeGlobalConfig({
    providers: { ...config.providers, [name]: provider },
    default: config.default ?? name, // first provider added becomes the default
  });

  console.log(`Added provider "${name}": ${describe(provider)}`);
  if (isFirst) console.log(`Set "${name}" as the default provider.`);
}

/** `config use <name>` — set the default provider. */
export async function configUse(name: string): Promise<void> {
  const config = await readGlobalConfig();
  if (!config.providers[name]) {
    const known = Object.keys(config.providers).join(", ") || "(none)";
    throw new Error(`Unknown provider "${name}". Configured: ${known}.`);
  }
  await writeGlobalConfig({ ...config, default: name });
  console.log(`Default provider is now "${name}".`);
}

/** `config test [name]` — ping a provider's endpoint (defaults to the default). */
export async function configTest(name?: string): Promise<void> {
  const provider = await resolveProvider({ providerFlag: name });
  process.stdout.write(
    `Pinging ${provider.baseURL ?? "(default endpoint)"} … `,
  );
  try {
    const models = await listModels(provider);
    console.log(`ok (${models.length} model(s) available).`);
  } catch (err) {
    console.log("failed.");
    throw err; // surfaces the reason and a non-zero exit via the CLI wrapper
  }
}
