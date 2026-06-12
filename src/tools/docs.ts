import { z } from "zod";
import { docsList, docsRead, docsSearch, docsWrite } from "../api/docs.js";
import { generateErDiagram, generateTableFlow } from "../api/diagrams.js";
import { ok } from "../mcp/result.js";
import { defineTool, type AnyToolSpec } from "../mcp/define.js";

/**
 * Self-documentation package: read/write a local Markdown knowledge base and
 * generate deterministic Mermaid diagrams from the instance's metadata. The
 * docs tools touch the local filesystem (SN_DOCS_DIR), confined to that folder.
 */
export const specs: AnyToolSpec[] = [
  defineTool({
    name: "servicenow_docs_list",
    title: "List instance docs",
    description:
      "List the Markdown documents in the local instance-documentation folder (SN_DOCS_DIR).",
    package: "docs",
    annotations: { readOnlyHint: true },
    input: {},
    handler: () => docsList().then(ok),
  }),

  defineTool({
    name: "servicenow_docs_read",
    title: "Read instance doc",
    description:
      "Read one Markdown document from the local instance-documentation folder.",
    package: "docs",
    annotations: { readOnlyHint: true },
    input: {
      path: z
        .string()
        .describe(
          "Document path relative to the docs folder, e.g. 'tables/incident.md'.",
        ),
    },
    logFields: (args) => ({ path: args.path }),
    handler: ({ path }) => docsRead(path).then(ok),
  }),

  defineTool({
    name: "servicenow_docs_search",
    title: "Search instance docs",
    description:
      "Search the local instance documentation for a substring; returns a snippet per match.",
    package: "docs",
    annotations: { readOnlyHint: true },
    input: {
      text: z
        .string()
        .describe("Substring to search for across all documents."),
    },
    logFields: (args) => ({ textLength: args.text.length }),
    handler: ({ text }) => docsSearch(text).then(ok),
  }),

  defineTool({
    name: "servicenow_docs_write",
    title: "Write instance doc",
    description:
      "Create or overwrite a Markdown document in the local docs folder and refresh index.md. " +
      "Use this to record durable knowledge (descriptions, Mermaid diagrams, instance quirks).",
    package: "docs",
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    input: {
      path: z
        .string()
        .describe(
          "Target document path relative to the docs folder, e.g. 'tables/incident.md'.",
        ),
      content: z.string().describe("Full Markdown content to write."),
    },
    logFields: (args) => ({ path: args.path }),
    handler: ({ path, content }) => docsWrite(path, content).then(ok),
  }),

  defineTool({
    name: "servicenow_generate_er_diagram",
    title: "Generate ER diagram",
    description:
      "Build a Mermaid erDiagram from sys_dictionary: an entity per table plus a relationship " +
      "for every reference field. Returns Mermaid markup ready to embed in Markdown.",
    package: "docs",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      tables: z
        .array(z.string())
        .min(1)
        .describe("Tables to include, e.g. ['incident', 'problem']."),
    },
    logFields: (args) => ({ tables: args.tables }),
    handler: ({ tables }) => generateErDiagram(tables).then(ok),
  }),

  defineTool({
    name: "servicenow_generate_table_flow",
    title: "Generate table flow",
    description:
      "Build a Mermaid flowchart of a record's lifecycle on a table, grouping active business " +
      "rules by phase (display/before/after/async) in execution order.",
    package: "docs",
    annotations: { readOnlyHint: true, openWorldHint: true },
    input: {
      table: z.string().describe("Table to diagram, e.g. 'incident'."),
    },
    logFields: (args) => ({ table: args.table }),
    handler: ({ table }) => generateTableFlow(table).then(ok),
  }),
];
