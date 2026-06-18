import { queryTable, getRecord } from "./table.js";
import { assertNoCaret, snString } from "./shared.js";
import { ServiceNowError } from "../core/errors.js";

/**
 * Flow intelligence (Phase 8, package `flows`, read-only). Three read-only
 * views built entirely on the Table API — no new ServiceNow API surface:
 *
 * - FT-2 `traceTableEvent`: a deterministic *simulation* — the ordered chain of
 *   what ServiceNow would run for a table + operation (display → before → after
 *   → async business rules, then flows/workflows, then notifications), each with
 *   its condition. Answers "if I update an incident, what runs and in what
 *   order?" without executing anything.
 * - FT-1 `listFlows` / `getFlow`: a structured view of Flow Designer
 *   (`sys_hub_flow`) and legacy workflows (`wf_workflow`).
 * - FT-3 `getFlowRuns`: execution evidence from `sys_flow_context`.
 *
 * Everything goes through the existing api/ layer, so auth, SSRF and table
 * policy apply unchanged.
 */

export type TableOperation = "insert" | "update" | "delete" | "query";

const OPERATION_FIELD: Record<TableOperation, string> = {
  insert: "action_insert",
  update: "action_update",
  delete: "action_delete",
  query: "action_query",
};

export interface ChainEntry {
  /** Execution phase, in the order ServiceNow runs them. */
  phase:
    | "display"
    | "before"
    | "database"
    | "after"
    | "async"
    | "flow"
    | "workflow"
    | "notification";
  type: string;
  name: string;
  order?: number;
  /** Encoded condition / filter, when the artefact declares one. */
  condition?: string;
  sys_id?: string;
}

export interface TableEventTrace {
  table: string;
  operation: TableOperation;
  chain: ChainEntry[];
  mermaid: string;
  warnings: string[];
}

/** Mermaid-safe node label (quotes/brackets break the parser). */
function mlabel(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/["[\]{}|]/g, "'")
    .slice(0, 60)
    .trim();
}

/** Business rules of one `when` phase for a table + operation, ordered. */
async function businessRules(
  table: string,
  when: string,
  operation: TableOperation,
  warnings: string[],
): Promise<ChainEntry[]> {
  try {
    const { records } = await queryTable({
      table: "sys_script",
      query: `collection=${table}^active=true^when=${when}^${OPERATION_FIELD[operation]}=true^ORDERBYorder`,
      fields: [
        "sys_id",
        "name",
        "order",
        "when",
        "condition",
        "filter_condition",
      ],
      displayValue: "false",
      limit: 200,
    });
    return records.map((r) => ({
      phase: when as ChainEntry["phase"],
      type: "business_rule",
      name: snString(r.name),
      order: r.order !== undefined ? Number(snString(r.order)) : undefined,
      condition:
        snString(r.condition) || snString(r.filter_condition) || undefined,
      sys_id: snString(r.sys_id) || undefined,
    }));
  } catch (e) {
    warnings.push(
      `business rules (${when}): ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

/** Flow Designer flows triggered on the table (via sys_hub_trigger_instance). */
async function flowsForTable(
  table: string,
  warnings: string[],
): Promise<ChainEntry[]> {
  try {
    const { records } = await queryTable({
      table: "sys_hub_trigger_instance",
      query: `table_name=${table}^flow.active=true`,
      fields: ["flow", "flow.name", "table_name", "condition", "trigger_type"],
      displayValue: "false",
      limit: 100,
    });
    return records.map((r) => ({
      phase: "flow" as const,
      type: snString(r.trigger_type) || "flow",
      name: snString(r["flow.name"]) || snString(r.flow),
      condition: snString(r.condition) || undefined,
      sys_id: snString(r.flow) || undefined,
    }));
  } catch (e) {
    warnings.push(
      `flows: ${e instanceof Error ? e.message : String(e)} (Flow Designer may be unavailable)`,
    );
    return [];
  }
}

/** Legacy workflows attached to the table. */
async function workflowsForTable(
  table: string,
  warnings: string[],
): Promise<ChainEntry[]> {
  try {
    const { records } = await queryTable({
      table: "wf_workflow",
      query: `table=${table}^active=true`,
      fields: ["sys_id", "name", "condition"],
      displayValue: "false",
      limit: 100,
    });
    return records.map((r) => ({
      phase: "workflow" as const,
      type: "workflow",
      name: snString(r.name),
      condition: snString(r.condition) || undefined,
      sys_id: snString(r.sys_id) || undefined,
    }));
  } catch (e) {
    warnings.push(`workflows: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** Notifications (sysevent_email_action) bound to the table. */
async function notificationsForTable(
  table: string,
  warnings: string[],
): Promise<ChainEntry[]> {
  try {
    const { records } = await queryTable({
      table: "sysevent_email_action",
      query: `collection=${table}^active=true`,
      fields: ["sys_id", "name", "condition", "event_name"],
      displayValue: "false",
      limit: 100,
    });
    return records.map((r) => ({
      phase: "notification" as const,
      type: "notification",
      name: snString(r.name),
      condition:
        snString(r.condition) ||
        (snString(r.event_name) ? `on ${snString(r.event_name)}` : undefined),
      sys_id: snString(r.sys_id) || undefined,
    }));
  } catch (e) {
    warnings.push(
      `notifications: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

function buildMermaid(
  table: string,
  operation: TableOperation,
  chain: ChainEntry[],
): string {
  const lines = [
    "flowchart TD",
    `  start[/"${operation} on ${mlabel(table)}"/]`,
  ];
  const phases: ChainEntry["phase"][] = [
    "display",
    "before",
    "database",
    "after",
    "async",
    "flow",
    "workflow",
    "notification",
  ];
  let prev = "start";
  let nid = 0;
  for (const phase of phases) {
    const entries = chain.filter((c) => c.phase === phase);
    if (phase === "database") {
      lines.push(`  db[("database write")]`);
      lines.push(`  ${prev} --> db`);
      prev = "db";
      continue;
    }
    if (entries.length === 0) continue;
    const sub = `P_${phase}`;
    lines.push(`  subgraph ${sub}["${phase}"]`);
    lines.push("    direction TB");
    let prevNode: string | undefined;
    for (const e of entries) {
      const id = `n${nid++}`;
      lines.push(`    ${id}["${mlabel(e.name)}"]`);
      if (prevNode) lines.push(`    ${prevNode} --> ${id}`);
      prevNode = id;
    }
    lines.push("  end");
    lines.push(`  ${prev} --> ${sub}`);
    prev = sub;
  }
  lines.push(`  ${prev} --> done([done])`);
  return lines.join("\n");
}

/**
 * FT-2 — deterministic trace of the automation a table operation triggers, in
 * execution order. Each section is best-effort: a failing query becomes a
 * warning instead of sinking the whole trace.
 */
export async function traceTableEvent(
  table: string,
  operation: TableOperation,
): Promise<TableEventTrace> {
  const t = table.trim();
  assertNoCaret(t, "table");
  if (!OPERATION_FIELD[operation]) {
    throw new ServiceNowError(
      `Unknown operation "${operation}". Use insert, update, delete or query.`,
      400,
    );
  }
  const warnings: string[] = [];
  const chain: ChainEntry[] = [];

  // Display runs only on form load / query; include it for completeness.
  chain.push(...(await businessRules(t, "display", operation, warnings)));
  chain.push(...(await businessRules(t, "before", operation, warnings)));
  chain.push({ phase: "database", type: "database", name: "database write" });
  chain.push(...(await businessRules(t, "after", operation, warnings)));
  chain.push(...(await businessRules(t, "async", operation, warnings)));
  chain.push(...(await flowsForTable(t, warnings)));
  chain.push(...(await workflowsForTable(t, warnings)));
  chain.push(...(await notificationsForTable(t, warnings)));

  return {
    table: t,
    operation,
    chain,
    mermaid: buildMermaid(t, operation, chain),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// FT-1 — Flow Designer + legacy workflow reading
// ---------------------------------------------------------------------------

export type FlowKind = "flow" | "workflow";

export interface FlowSummary {
  kind: FlowKind;
  sys_id: string;
  name: string;
  active?: string;
  description?: string;
  table?: string;
}

export interface ListFlowsOptions {
  kind?: FlowKind;
  table?: string;
  active?: boolean;
  name?: string;
  limit?: number;
}

/** FT-1 — list Flow Designer flows (or legacy workflows) as compact metadata. */
export async function listFlows(
  opts: ListFlowsOptions = {},
): Promise<{ kind: FlowKind; count: number; flows: FlowSummary[] }> {
  const kind: FlowKind = opts.kind ?? "flow";
  if (opts.name?.trim()) assertNoCaret(opts.name, "name");
  if (opts.table?.trim()) assertNoCaret(opts.table, "table");

  if (kind === "workflow") {
    const clauses: string[] = [];
    if (opts.table?.trim()) clauses.push(`table=${opts.table.trim()}`);
    if (opts.active !== undefined) clauses.push(`active=${opts.active}`);
    if (opts.name?.trim()) clauses.push(`nameLIKE${opts.name.trim()}`);
    clauses.push("ORDERBYname");
    const { records } = await queryTable({
      table: "wf_workflow",
      query: clauses.join("^"),
      fields: ["sys_id", "name", "active", "description", "table"],
      displayValue: "false",
      limit: opts.limit ?? 50,
    });
    const flows = records.map((r) => ({
      kind,
      sys_id: snString(r.sys_id),
      name: snString(r.name),
      active: snString(r.active) || undefined,
      description: snString(r.description) || undefined,
      table: snString(r.table) || undefined,
    }));
    return { kind, count: flows.length, flows };
  }

  // Flow Designer: a table filter means "flows whose trigger is on that table".
  let flowIdFilter = "";
  if (opts.table?.trim()) {
    const { records } = await queryTable({
      table: "sys_hub_trigger_instance",
      query: `table_name=${opts.table.trim()}`,
      fields: ["flow"],
      displayValue: "false",
      limit: 500,
    });
    const ids = [
      ...new Set(records.map((r) => snString(r.flow)).filter(Boolean)),
    ];
    if (ids.length === 0) return { kind, count: 0, flows: [] };
    flowIdFilter = `sys_idIN${ids.join(",")}^`;
  }
  const clauses: string[] = [];
  if (opts.active !== undefined) clauses.push(`active=${opts.active}`);
  if (opts.name?.trim()) clauses.push(`nameLIKE${opts.name.trim()}`);
  clauses.push("ORDERBYname");
  const { records } = await queryTable({
    table: "sys_hub_flow",
    query: flowIdFilter + clauses.join("^"),
    fields: ["sys_id", "name", "active", "description"],
    displayValue: "false",
    limit: opts.limit ?? 50,
  });
  const flows = records.map((r) => ({
    kind,
    sys_id: snString(r.sys_id),
    name: snString(r.name),
    active: snString(r.active) || undefined,
    description: snString(r.description) || undefined,
  }));
  return { kind, count: flows.length, flows };
}

export interface FlowTrigger {
  table?: string;
  type?: string;
  condition?: string;
  when?: string;
}

export interface FlowStep {
  order?: number;
  action: string;
  type?: string;
}

export interface FlowDetail {
  kind: FlowKind;
  sys_id: string;
  name: string;
  active?: string;
  description?: string;
  trigger?: FlowTrigger;
  steps: FlowStep[];
}

/**
 * FT-1 — a structured view of one flow: its trigger and ordered steps. Not a
 * full decompilation — enough for a model to reason about the logic.
 */
export async function getFlow(
  sysId: string,
  kind: FlowKind = "flow",
): Promise<FlowDetail> {
  if (kind === "workflow") {
    const wf = await getRecord("wf_workflow", sysId, [
      "sys_id",
      "name",
      "active",
      "description",
      "table",
      "condition",
    ]);
    const { records: activities } = await queryTable({
      table: "wf_activity",
      query: `workflow=${sysId}^ORDERBYorder`,
      fields: ["name", "order", "activity_definition"],
      displayValue: "false",
      limit: 200,
    });
    return {
      kind,
      sys_id: snString(wf.sys_id),
      name: snString(wf.name),
      active: snString(wf.active) || undefined,
      description: snString(wf.description) || undefined,
      trigger: {
        table: snString(wf.table) || undefined,
        condition: snString(wf.condition) || undefined,
      },
      steps: activities.map((a) => ({
        order: a.order !== undefined ? Number(snString(a.order)) : undefined,
        action: snString(a.name),
        type: snString(a.activity_definition) || undefined,
      })),
    };
  }

  const flow = await getRecord("sys_hub_flow", sysId, [
    "sys_id",
    "name",
    "active",
    "description",
  ]);
  let trigger: FlowTrigger | undefined;
  try {
    const { records } = await queryTable({
      table: "sys_hub_trigger_instance",
      query: `flow=${sysId}`,
      fields: ["table_name", "trigger_type", "condition", "when_to_run"],
      displayValue: "false",
      limit: 1,
    });
    const t = records[0];
    if (t) {
      trigger = {
        table: snString(t.table_name) || undefined,
        type: snString(t.trigger_type) || undefined,
        condition: snString(t.condition) || undefined,
        when: snString(t.when_to_run) || undefined,
      };
    }
  } catch {
    // trigger optional
  }
  const { records: actions } = await queryTable({
    table: "sys_hub_action_instance",
    query: `flow=${sysId}^ORDERBYorder`,
    fields: ["order", "action_type", "action_type.name"],
    displayValue: "false",
    limit: 200,
  });
  return {
    kind,
    sys_id: snString(flow.sys_id),
    name: snString(flow.name),
    active: snString(flow.active) || undefined,
    description: snString(flow.description) || undefined,
    trigger,
    steps: actions.map((a) => ({
      order: a.order !== undefined ? Number(snString(a.order)) : undefined,
      action: snString(a["action_type.name"]) || snString(a.action_type),
      type: snString(a.action_type) || undefined,
    })),
  };
}

// ---------------------------------------------------------------------------
// FT-3 — execution evidence
// ---------------------------------------------------------------------------

export interface FlowRun {
  sys_id: string;
  name: string;
  state?: string;
  table?: string;
  recordId?: string;
  started?: string;
  updated?: string;
}

export interface FlowRunsOptions {
  /** Flow sys_id to scope by (matches sys_flow_context.flow). */
  flow?: string;
  /** Record sys_id (document_id) the flow ran against. */
  record?: string;
  limit?: number;
}

/**
 * FT-3 — flow execution history from `sys_flow_context`, by flow or by record.
 * Closes the loop on FT-2: did the flow that *should* run actually run, and
 * with what outcome?
 */
export async function getFlowRuns(
  opts: FlowRunsOptions = {},
): Promise<{ count: number; runs: FlowRun[] }> {
  const clauses: string[] = [];
  if (opts.flow?.trim()) {
    assertNoCaret(opts.flow, "flow");
    clauses.push(`flow=${opts.flow.trim()}`);
  }
  if (opts.record?.trim()) {
    assertNoCaret(opts.record, "record");
    clauses.push(`document_id=${opts.record.trim()}`);
  }
  if (clauses.length === 0) {
    throw new ServiceNowError(
      "getFlowRuns needs at least a flow or a record sys_id.",
      400,
    );
  }
  clauses.push("ORDERBYDESCsys_created_on");
  const { records } = await queryTable({
    table: "sys_flow_context",
    query: clauses.join("^"),
    fields: [
      "sys_id",
      "name",
      "state",
      "table",
      "document_id",
      "sys_created_on",
      "sys_updated_on",
    ],
    displayValue: "true",
    limit: opts.limit ?? 50,
  });
  const runs = records.map((r) => ({
    sys_id: snString(r.sys_id),
    name: snString(r.name),
    state: snString(r.state) || undefined,
    table: snString(r.table) || undefined,
    recordId: snString(r.document_id) || undefined,
    started: snString(r.sys_created_on) || undefined,
    updated: snString(r.sys_updated_on) || undefined,
  }));
  return { count: runs.length, runs };
}
