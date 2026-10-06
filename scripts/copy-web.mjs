import fs from "node:fs/promises";
await fs.mkdir("dist/src/web/public", { recursive: true });
await fs.cp("src/web/public", "dist/src/web/public", { recursive: true });
