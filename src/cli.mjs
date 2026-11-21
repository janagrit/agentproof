// One argument parser for every script. Unknown flags are an error, so a typo
// like --mutant (instead of --mutants) fails loudly instead of being ignored.
import { parseArgs } from "node:util";

/**
 * @param {{ flags?: string[], options?: Record<string, string|undefined> }} spec
 *   flags: boolean switches (--mock). options: string options with defaults.
 * @param {string[]} [argv]
 */
export function parseCli({ flags = [], options = {} } = {}, argv = process.argv.slice(2)) {
  const config = {};
  for (const f of flags) config[f] = { type: "boolean", default: false };
  for (const [name, def] of Object.entries(options)) {
    config[name] = def === undefined ? { type: "string" } : { type: "string", default: def };
  }
  try {
    return parseArgs({ args: argv, options: config, strict: true, allowPositionals: false }).values;
  } catch (e) {
    const known = [...flags.map(f => `--${f}`), ...Object.keys(options).map(o => `--${o} <value>`)];
    console.error(`${e.message}\nKnown options: ${known.join(" ")}`);
    process.exit(2);
  }
}

// "a,b, c" -> ["a","b","c"]; undefined/"" -> undefined (meaning "all").
export const list = s => (s ? s.split(",").map(x => x.trim()).filter(Boolean) : undefined);
