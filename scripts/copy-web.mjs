import fs from "node:fs/promises";
// Start clean so assets removed from src/web/public do not linger in dist.
await fs.rm("dist/src/web/public", { recursive: true, force: true });
await fs.mkdir("dist/src/web/public", { recursive: true });
await fs.cp("src/web/public", "dist/src/web/public", { recursive: true });
