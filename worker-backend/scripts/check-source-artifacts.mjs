import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// Explicit .js imports can resolve to old tsc output instead of current .ts.
// Fail closed before Wrangler builds; never silently delete developers' files.
const root = fileURLToPath(new URL("../../", import.meta.url));
const conflicts = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith(".js") && existsSync(path.slice(0, -3) + ".ts")) conflicts.push(relative(root, path));
  }
}
for (const directory of ["worker-backend/src", "backend/src", "shared-types/src"]) visit(join(root, directory));
if (conflicts.length) {
  console.error("Stale JavaScript artifacts shadow TypeScript sources. Back up these files outside src before building:\n" + conflicts.join("\n"));
  process.exitCode = 1;
}
