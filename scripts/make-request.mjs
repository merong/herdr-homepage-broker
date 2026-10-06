import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
const [project_id, directory, prd, design] = process.argv.slice(2);
if (!design) {
  console.error(
    "node scripts/make-request.mjs PROJECT_ID DIRECTORY PRD_PATH DESIGN_PATH > request.json",
  );
  process.exit(2);
}
const doc = (p) => ({
  path: fs.realpathSync(p),
  sha256: createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
});
console.log(
  JSON.stringify(
    {
      schema_version: 1,
      command_id: randomUUID(),
      type: "submit",
      project_id,
      payload: {
        directory: path.resolve(directory),
        inputs: { prd: doc(prd), design: doc(design) },
      },
    },
    null,
    2,
  ),
);
