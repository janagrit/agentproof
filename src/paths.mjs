// Repo-root-relative paths, so every script works no matter which directory
// it is started from.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// rootPath("app", "index.html") -> <repo>/app/index.html.
// Absolute inputs are returned unchanged, so a user-supplied --out /tmp/x still works.
export const rootPath = (...parts) => path.resolve(ROOT, ...parts);

// For paths the user typed on the command line: relative to where they ran the
// command, like any normal CLI.
export const userPath = p => path.resolve(process.cwd(), p);
