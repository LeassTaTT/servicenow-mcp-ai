import { z } from "zod";
import {
  listCmdbInstances,
  getCmdbInstance,
  createCmdbInstance,
  updateCmdbInstance,
  getCmdbMeta,
} from "../api/cmdb.js";
import { ok } from "../mcp/result.js";
import { defineTool, type AnyToolSpec } from "../mcp/define.js";

const attributes = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .describe("CI attribute name/value pairs.");

export const specs: AnyToolSpec[] = [
  defineTool({
    name: "servicenow_list_cis",
    title: "List configuration items",
    description:
      "List configuration items of a CMDB class through the class-aware CMDB Instance API.",
    package: "cmdb",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      class_name: z
        .string()
        .describe("CMDB class/table, e.g. 'cmdb_ci_server'."),
      query: z.string().optional().describe("Encoded query (sysparm_query)."),
      limit: z.number().int().positive().max(1000).optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    logFields: (args) => ({ class_name: args.class_name }),
    handler: async ({ class_name, query, limit, offset }) =>
      ok({
        result: await listCmdbInstances(class_name, { query, limit, offset }),
      }),
  }),

  defineTool({
    name: "servicenow_get_ci",
    title: "Get configuration item",
    description:
      "Get a CI with its attributes and inbound/outbound relations by class and sys_id.",
    package: "cmdb",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      class_name: z.string().describe("CMDB class, e.g. 'cmdb_ci_server'."),
      sys_id: z.string().describe("sys_id of the CI."),
    },
    logFields: (args) => ({ class_name: args.class_name }),
    handler: async ({ class_name, sys_id }) =>
      ok({ result: await getCmdbInstance(class_name, sys_id) }),
  }),

  defineTool({
    name: "servicenow_create_ci",
    title: "Create configuration item",
    description:
      "Create a CI via the CMDB Instance API (routed through Identification & Reconciliation).",
    package: "cmdb",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    input: {
      class_name: z.string().describe("CMDB class, e.g. 'cmdb_ci_server'."),
      attributes,
      source: z
        .string()
        .optional()
        .describe("Discovery source recorded by IRE (e.g. 'ServiceNow')."),
    },
    logFields: (args) => ({ class_name: args.class_name }),
    handler: async ({ class_name, attributes: attrs, source }) => {
      const result = await createCmdbInstance({
        className: class_name,
        attributes: attrs,
        source,
      });
      return ok({ message: "CI created", result });
    },
  }),

  defineTool({
    name: "servicenow_update_ci",
    title: "Update configuration item",
    description: "Update a CI's attributes via the CMDB Instance API (IRE).",
    package: "cmdb",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    input: {
      class_name: z.string().describe("CMDB class, e.g. 'cmdb_ci_server'."),
      sys_id: z.string().describe("sys_id of the CI."),
      attributes,
      source: z.string().optional().describe("Discovery source for IRE."),
    },
    logFields: (args) => ({ class_name: args.class_name }),
    handler: async ({ class_name, sys_id, attributes: attrs, source }) => {
      const result = await updateCmdbInstance(sys_id, {
        className: class_name,
        attributes: attrs,
        source,
      });
      return ok({ message: "CI updated", result });
    },
  }),

  defineTool({
    name: "servicenow_get_cmdb_meta",
    title: "Get CMDB class metadata",
    description:
      "Get the schema/metadata of a CMDB class (attributes, relationship rules) from the CMDB Meta API.",
    package: "cmdb",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      class_name: z.string().describe("CMDB class, e.g. 'cmdb_ci_server'."),
    },
    logFields: (args) => ({ class_name: args.class_name }),
    handler: async ({ class_name }) =>
      ok({ result: await getCmdbMeta(class_name) }),
  }),
];
