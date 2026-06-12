import { z } from "zod";
import {
  queryTable,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
} from "../api/table.js";
import { ok, okQueryResult } from "../mcp/result.js";
import { defineTool, type AnyToolSpec } from "../mcp/define.js";

/**
 * A ServiceNow field value. The Table API accepts flat scalar values only;
 * nested objects/arrays are rejected, so they are disallowed here.
 */
const fieldsSchema = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const specs: AnyToolSpec[] = [
  defineTool({
    name: "servicenow_query_table",
    title: "Query ServiceNow table",
    description:
      "Read records from any ServiceNow table through the Table API. Supports encoded queries, field selection and pagination.",
    package: "table",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      table: z
        .string()
        .describe("Table name, e.g. 'incident', 'sys_user', 'change_request'."),
      query: z
        .string()
        .optional()
        .describe(
          "Encoded query (sysparm_query), e.g. 'active=true^priority=1^ORDERBYDESCsys_created_on'.",
        ),
      fields: z
        .array(z.string())
        .optional()
        .describe("Columns to return. Omit to return all columns."),
      limit: z
        .number()
        .int()
        .positive()
        .max(1000)
        .optional()
        .describe("Maximum number of records to return (default 10)."),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Number of records to skip, for pagination."),
      displayValue: z
        .enum(["true", "false", "all"])
        .optional()
        .describe(
          "Return display values ('true'), raw values ('false', default) or both ('all').",
        ),
      fetchAll: z
        .boolean()
        .optional()
        .describe(
          "When true, page through all matching records (up to the server's SN_MAX_RECORDS cap) instead of a single page.",
        ),
    },
    logFields: (args) => ({ table: args.table }),
    handler: async (args) => {
      const { records, total } = await queryTable(args);
      return okQueryResult(records, total);
    },
  }),

  defineTool({
    name: "servicenow_get_record",
    title: "Get ServiceNow record",
    description: "Read a single record from a table by its sys_id.",
    package: "table",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      table: z.string().describe("Table name, e.g. 'incident'."),
      sys_id: z.string().describe("The sys_id of the record to read."),
      fields: z
        .array(z.string())
        .optional()
        .describe("Columns to return. Omit to return all columns."),
    },
    logFields: (args) => ({ table: args.table }),
    handler: async ({ table, sys_id, fields }) =>
      ok(await getRecord(table, sys_id, fields)),
  }),

  defineTool({
    name: "servicenow_create_record",
    title: "Create ServiceNow record",
    description: "Create a new record in a table with the given field values.",
    package: "table",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    input: {
      table: z.string().describe("Table name, e.g. 'incident'."),
      fields: fieldsSchema.describe(
        'Field name/value pairs for the new record, e.g. { "short_description": "Printer down", "urgency": "2" }.',
      ),
    },
    logFields: (args) => ({ table: args.table }),
    handler: async ({ table, fields }) => {
      const record = await createRecord(table, fields);
      return ok({ message: "Record created", record });
    },
  }),

  defineTool({
    name: "servicenow_update_record",
    title: "Update ServiceNow record",
    description: "Update fields on an existing record identified by its sys_id.",
    package: "table",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    input: {
      table: z.string().describe("Table name, e.g. 'incident'."),
      sys_id: z.string().describe("The sys_id of the record to update."),
      fields: fieldsSchema.describe(
        "Field name/value pairs to change on the record.",
      ),
    },
    logFields: (args) => ({ table: args.table }),
    handler: async ({ table, sys_id, fields }) => {
      const record = await updateRecord(table, sys_id, fields);
      return ok({ message: "Record updated", record });
    },
  }),

  defineTool({
    name: "servicenow_delete_record",
    title: "Delete ServiceNow record",
    description: "Delete a record from a table by its sys_id.",
    package: "table",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    input: {
      table: z.string().describe("Table name, e.g. 'incident'."),
      sys_id: z.string().describe("The sys_id of the record to delete."),
    },
    logFields: (args) => ({ table: args.table }),
    handler: async ({ table, sys_id }) => {
      const result = await deleteRecord(table, sys_id);
      return ok({ message: "Record deleted", ...result });
    },
  }),
];
