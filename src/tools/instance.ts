import { z } from "zod";
import { snapshotInstance } from "../api/snapshot.js";
import { ok } from "../mcp/result.js";
import { defineTool, type AnyToolSpec } from "../mcp/define.js";

/**
 * Instance analysis package (Phase 7): snapshot an instance's structural
 * metadata into the local docs folder; instance comparison (MI-7) joins it
 * next. Reads go through the regular api/ layers, output lands under
 * SN_DOCS_DIR/<profile>/.
 */
export const specs: AnyToolSpec[] = [
  defineTool({
    name: "servicenow_snapshot_instance",
    title: "Snapshot instance metadata",
    description:
      "Download the instance's structural metadata into the local docs folder " +
      "(SN_DOCS_DIR/<profile>/): tables.md+json, schema/<table>.md for the given tables, " +
      "plugins, installed apps and script-automation statistics, plus an index.md. " +
      "Markdown is for humans/LLMs, the JSON companions feed instance comparison. " +
      "Idempotent: re-running overwrites the previous snapshot of the same profile.",
    package: "instance",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    input: {
      tables: z
        .array(z.string())
        .optional()
        .describe(
          "Tables to document in detail as schema/<table>.md, e.g. ['incident', 'change_request']. Omit for none.",
        ),
    },
    logFields: (args) => ({ tables: args.tables?.length ?? 0 }),
    handler: ({ tables }) => snapshotInstance({ tables }).then(ok),
  }),
];
