import { z } from "zod";
import {
  traceTableEvent,
  listFlows,
  getFlow,
  getFlowRuns,
} from "../api/flows.js";
import { ok } from "../mcp/result.js";
import { defineTool, type AnyToolSpec } from "../mcp/define.js";

/**
 * Flow intelligence package (Phase 8): read-only views of what would run on a
 * table (deterministic trace), what Flow Designer / workflows are configured,
 * and what actually ran. All over the Table API.
 */
export const specs: AnyToolSpec[] = [
  defineTool({
    name: "servicenow_trace_table_event",
    title: "Trace a table event",
    description:
      "Deterministically trace what ServiceNow would run for a table operation, in execution order: " +
      "display/before/after/async business rules, then flows, workflows and notifications — each with its " +
      "condition, plus a Mermaid flowchart. A logical test without executing anything.",
    package: "flows",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      table: z.string().describe("Table to trace, e.g. 'incident'."),
      operation: z
        .enum(["insert", "update", "delete", "query"])
        .describe("The database operation to simulate."),
    },
    logFields: (args) => ({ table: args.table, operation: args.operation }),
    handler: ({ table, operation }) =>
      traceTableEvent(table, operation).then(ok),
  }),

  defineTool({
    name: "servicenow_list_flows",
    title: "List flows",
    description:
      "List Flow Designer flows (sys_hub_flow) or legacy workflows (kind: 'workflow') as compact " +
      "metadata. Filter by applied table, active flag or a name fragment.",
    package: "flows",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      kind: z
        .enum(["flow", "workflow"])
        .optional()
        .describe("'flow' (Flow Designer, default) or 'workflow' (legacy)."),
      table: z
        .string()
        .optional()
        .describe("Only flows triggered on this table."),
      active: z.boolean().optional().describe("Filter by the active flag."),
      name: z
        .string()
        .optional()
        .describe("Case-insensitive fragment to match in the name."),
      limit: z.number().int().positive().max(1000).optional(),
    },
    logFields: (args) => ({ kind: args.kind ?? "flow" }),
    handler: (args) => listFlows(args).then(ok),
  }),

  defineTool({
    name: "servicenow_get_flow",
    title: "Get flow detail",
    description:
      "Get a structured view of one flow or workflow: its trigger (table/condition/when) and ordered " +
      "steps. Not a full decompilation — enough to reason about the logic.",
    package: "flows",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      sys_id: z.string().describe("sys_id of the flow or workflow."),
      kind: z
        .enum(["flow", "workflow"])
        .optional()
        .describe("'flow' (default) or 'workflow'."),
    },
    logFields: (args) => ({ kind: args.kind ?? "flow" }),
    handler: ({ sys_id, kind }) => getFlow(sys_id, kind).then(ok),
  }),

  defineTool({
    name: "servicenow_get_flow_runs",
    title: "Get flow run history",
    description:
      "Read flow execution evidence from sys_flow_context — by flow sys_id or by the record (document) " +
      "it ran against: when it started, its state and the outcome.",
    package: "flows",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      flow: z.string().optional().describe("Flow sys_id to scope by."),
      record: z
        .string()
        .optional()
        .describe("Record sys_id the flow ran against (document_id)."),
      limit: z.number().int().positive().max(1000).optional(),
    },
    handler: (args) => getFlowRuns(args).then(ok),
  }),
];
