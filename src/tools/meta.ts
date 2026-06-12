import { z } from "zod";
import { listTables, describeTable } from "../api/meta.js";
import { ok } from "../mcp/result.js";
import { defineTool, type AnyToolSpec } from "../mcp/define.js";

export const specs: AnyToolSpec[] = [
  defineTool({
    name: "servicenow_list_tables",
    title: "List ServiceNow tables",
    description:
      "List tables from sys_db_object, optionally filtered by a name or label fragment.",
    package: "schema",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      filter: z
        .string()
        .optional()
        .describe("Case-insensitive fragment to match in name or label."),
    },
    handler: async ({ filter }) => {
      const tables = await listTables(filter);
      return ok({ count: tables.length, tables });
    },
  }),

  defineTool({
    name: "servicenow_describe_table",
    title: "Describe ServiceNow table",
    description:
      "List a table's columns (name, label, type, mandatory, reference) from sys_dictionary.",
    package: "schema",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      table: z.string().describe("Table name to describe, e.g. 'incident'."),
    },
    logFields: (args) => ({ table: args.table }),
    handler: async ({ table }) => {
      const columns = await describeTable(table);
      return ok({ table, count: columns.length, columns });
    },
  }),
];
