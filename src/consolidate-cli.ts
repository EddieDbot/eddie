import { runConsolidation } from "./proactive/consolidate.ts";

console.log("Running consolidation...");
await runConsolidation();
console.log("Done.");
