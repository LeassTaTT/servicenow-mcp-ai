# ServiceNow MCP — VS Code extension

Drive a **ServiceNow** instance from VS Code **Copilot Chat (agent mode)**. This
extension registers the [`servicenow-mcp-ai`](https://www.npmjs.com/package/servicenow-mcp-ai)
MCP server automatically — install it and the ServiceNow tools appear in Chat,
with no manual `.vscode/mcp.json`.

## What you get

67 tools over the full ServiceNow REST surface (Table, Aggregate, Attachment,
Import Set, Batch, CMDB/IRE, Catalog, Change, Knowledge, Email), plus:

- **Plan-and-apply write safety** — writes preview a before/after diff by default
  (`SN_WRITE_MODE=plan`); execute only with `apply: true`. Every applied change is
  journalled locally.
- **Capability preflight** — reports which `sys_*` tables your user can actually
  read, so the script/code tools never return a silently empty result.
- **ACL security scan**, **where-used / impact graph**, **field redaction**,
  **CSV export**, and a **CI drift gate**.

## Setup

1. Install this extension. The **ServiceNow** MCP server is registered for Copilot
   Chat (it runs via `npx -y servicenow-mcp-ai`, so Node.js 20+ is required).
2. Provide credentials one of two ways:
   - an env file at `~/.config/servicenow-mcp-ai/.env`:
     ```dotenv
     SN_INSTANCE=your-instance.service-now.com
     SN_USER=your.username
     SN_PASSWORD=your-password
     ```
   - or, at runtime, ask Chat to run `servicenow_set_credentials`.
3. Open Copilot Chat, switch to **agent mode**, and ask — e.g. _"Using ServiceNow,
   list the 5 most recent active incidents with their priority."_

Start read-only and safe: set `SN_READONLY=true` and keep the default
`SN_TOOL_PACKAGES=core` until you trust the workflow.

## Links

- Documentation: https://leasstatt.github.io/servicenow-mcp-ai/
- Source / issues: https://github.com/LeassTaTT/servicenow-mcp-ai
- npm package: https://www.npmjs.com/package/servicenow-mcp-ai

MIT licensed. Independent project — not affiliated with or endorsed by ServiceNow, Inc.
