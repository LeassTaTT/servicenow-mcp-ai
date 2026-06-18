import test from "node:test";
import assert from "node:assert/strict";

import {
  traceTableEvent,
  listFlows,
  getFlow,
  getFlowRuns,
} from "../build/api/flows.js";
import { ServiceNowError } from "../build/core/errors.js";
import { baselineEnv, withFetch, jsonResponse } from "./helpers.js";

baselineEnv();

const tableOf = (url) => {
  const m = /\/api\/now\/table\/([^/?]+)/.exec(url);
  return m ? m[1] : "";
};
const queryOf = (url) =>
  new URL(url, "https://x").searchParams.get("sysparm_query") || "";

test("traceTableEvent builds the ordered chain with a Mermaid flowchart (FT-2)", async () => {
  await withFetch(
    (url) => {
      const table = tableOf(url);
      const q = queryOf(url);
      if (table === "sys_script") {
        if (/when=before/.test(q))
          return jsonResponse(200, {
            result: [
              {
                sys_id: "b1",
                name: "Set defaults",
                order: "100",
                when: "before",
                condition: "priority=1",
              },
            ],
          });
        if (/when=after/.test(q))
          return jsonResponse(200, {
            result: [
              {
                sys_id: "a1",
                name: "Notify group",
                order: "200",
                when: "after",
              },
            ],
          });
        return jsonResponse(200, { result: [] }); // display, async
      }
      if (table === "sys_hub_trigger_instance")
        return jsonResponse(200, {
          result: [
            {
              flow: "f1",
              "flow.name": "Incident SLA",
              table_name: "incident",
              trigger_type: "record_update",
            },
          ],
        });
      if (table === "wf_workflow") return jsonResponse(200, { result: [] });
      if (table === "sysevent_email_action")
        return jsonResponse(200, {
          result: [{ sys_id: "n1", name: "Incident assigned", condition: "" }],
        });
      throw new Error("unexpected table " + table);
    },
    async () => {
      const trace = await traceTableEvent("incident", "update");
      const phases = trace.chain.map((c) => c.phase);
      // before precedes database, which precedes after/async/flow/notification.
      assert.ok(phases.indexOf("before") < phases.indexOf("database"));
      assert.ok(phases.indexOf("database") < phases.indexOf("after"));
      assert.ok(phases.includes("flow"));
      assert.ok(phases.includes("notification"));
      const before = trace.chain.find((c) => c.phase === "before");
      assert.equal(before.name, "Set defaults");
      assert.equal(before.condition, "priority=1");
      assert.match(trace.mermaid, /^flowchart TD/);
      assert.match(trace.mermaid, /database write/);
      assert.equal(trace.warnings.length, 0);
    },
  );
});

test("traceTableEvent rejects a caret in the table before any request (FT-2)", async () => {
  await withFetch(
    () => {
      throw new Error("fetch must not run for a caret table");
    },
    async (calls) => {
      await assert.rejects(
        traceTableEvent("incident^active=true", "update"),
        (err) =>
          err instanceof ServiceNowError && /cannot contain/.test(err.message),
      );
      assert.equal(calls.length, 0);
    },
  );
});

test("a failing section becomes a warning, not a failed trace (FT-2)", async () => {
  await withFetch(
    (url) => {
      if (tableOf(url) === "wf_workflow")
        return jsonResponse(403, { error: { message: "no access" } });
      return jsonResponse(200, { result: [] });
    },
    async () => {
      const trace = await traceTableEvent("incident", "insert");
      assert.ok(trace.warnings.some((w) => /workflows/.test(w)));
      // The database step is always present even when everything else is empty.
      assert.ok(trace.chain.some((c) => c.phase === "database"));
    },
  );
});

test("listFlows reads sys_hub_flow and maps metadata (FT-1)", async () => {
  await withFetch(
    (url) => {
      assert.equal(tableOf(url), "sys_hub_flow");
      return jsonResponse(200, {
        result: [
          {
            sys_id: "f1",
            name: "Onboarding",
            active: "true",
            description: "x",
          },
        ],
      });
    },
    async () => {
      const { kind, count, flows } = await listFlows({ active: true });
      assert.equal(kind, "flow");
      assert.equal(count, 1);
      assert.equal(flows[0].name, "Onboarding");
    },
  );
});

test("getFlow assembles trigger + ordered steps (FT-1)", async () => {
  await withFetch(
    (url) => {
      const table = tableOf(url);
      if (table === "sys_hub_flow")
        return jsonResponse(200, {
          result: { sys_id: "f1", name: "SLA flow", active: "true" },
        });
      if (table === "sys_hub_trigger_instance")
        return jsonResponse(200, {
          result: [
            {
              table_name: "incident",
              trigger_type: "record_update",
              condition: "active=true",
            },
          ],
        });
      if (table === "sys_hub_action_instance")
        return jsonResponse(200, {
          result: [
            {
              order: "1",
              action_type: "at1",
              "action_type.name": "Create Task",
            },
            {
              order: "2",
              action_type: "at2",
              "action_type.name": "Send Notification",
            },
          ],
        });
      throw new Error("unexpected " + table);
    },
    async () => {
      const flow = await getFlow("f1");
      assert.equal(flow.name, "SLA flow");
      assert.equal(flow.trigger.table, "incident");
      assert.equal(flow.steps.length, 2);
      assert.equal(flow.steps[0].action, "Create Task");
    },
  );
});

test("getFlowRuns needs a flow or record, then reads sys_flow_context (FT-3)", async () => {
  await withFetch(
    () => {
      throw new Error("fetch must not run without a filter");
    },
    async (calls) => {
      await assert.rejects(
        getFlowRuns({}),
        (err) => err instanceof ServiceNowError && err.status === 400,
      );
      assert.equal(calls.length, 0);
    },
  );

  await withFetch(
    (url) => {
      assert.equal(tableOf(url), "sys_flow_context");
      assert.match(queryOf(url), /document_id=rec1/);
      return jsonResponse(200, {
        result: [
          {
            sys_id: "c1",
            name: "SLA flow",
            state: "Complete",
            document_id: "rec1",
            sys_created_on: "2026-01-01",
          },
        ],
      });
    },
    async () => {
      const { count, runs } = await getFlowRuns({ record: "rec1" });
      assert.equal(count, 1);
      assert.equal(runs[0].state, "Complete");
      assert.equal(runs[0].recordId, "rec1");
    },
  );
});
