import { z } from "zod";
import { snapshotInstance } from "../api/snapshot.js";
import { compareInstances } from "../api/compare.js";
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

  defineTool({
    name: "servicenow_compare_instances",
    title: "Compare two instances",
    description:
      "Diff two connection profiles: tables present in only one, common columns whose " +
      "type/mandatory/reference differ, scripts (per type+name) missing or with different " +
      "source (compared by SHA-256, always live), and plugin/app inventory differences. " +
      "Writes a Markdown report to _compare/<a>-vs-<b>.md in the docs folder and returns " +
      "the structured summary. With from_snapshot, tables/plugins/apps are read from the " +
      "profiles' stored snapshots when available.",
    package: "instance",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    input: {
      a: z.string().describe("First connection profile, e.g. 'dev'."),
      b: z.string().describe("Second connection profile, e.g. 'prod'."),
      from_snapshot: z
        .boolean()
        .optional()
        .describe(
          "Prefer the stored servicenow_snapshot_instance JSON files for tables/plugins/apps when present (default false: everything live).",
        ),
    },
    logFields: (args) => ({
      a: args.a,
      b: args.b,
      fromSnapshot: args.from_snapshot === true,
    }),
    handler: ({ a, b, from_snapshot }) =>
      compareInstances({ a, b, fromSnapshot: from_snapshot }).then(ok),
  }),
];
