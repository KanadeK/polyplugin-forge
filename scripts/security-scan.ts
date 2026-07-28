import { resolve } from "node:path";

import { verifySourceHygiene } from "./release-check.js";

const projectRoot = resolve(import.meta.dirname, "..");
await verifySourceHygiene(projectRoot);
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      scope:
        "tracked text files, excluding the synthetic secret-detector unit fixture",
      checks: ["secret patterns", "empty implementation markers"]
    },
    null,
    2
  )}\n`
);
