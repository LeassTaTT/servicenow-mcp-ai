import * as vscode from "vscode";

/**
 * Registers the `servicenow-mcp-ai` MCP server with VS Code so it appears in
 * Copilot Chat (agent mode) the moment the extension is installed — no manual
 * `.vscode/mcp.json`. The server runs via `npx -y servicenow-mcp-ai`, so it
 * always resolves the published package; credentials are supplied through the
 * env file (`~/.config/servicenow-mcp-ai/.env`) or at runtime via the
 * `servicenow_set_credentials` tool.
 */
export function activate(context: vscode.ExtensionContext): void {
  const didChange = new vscode.EventEmitter<void>();

  context.subscriptions.push(
    didChange,
    vscode.lm.registerMcpServerDefinitionProvider("servicenow-mcp-ai", {
      onDidChangeMcpServerDefinitions: didChange.event,
      provideMcpServerDefinitions: async () => [
        new vscode.McpStdioServerDefinition("ServiceNow", "npx", [
          "-y",
          "servicenow-mcp-ai",
        ]),
      ],
      resolveMcpServerDefinition: async (server) => server,
    }),
  );
}

export function deactivate(): void {
  // Registration is disposed via context.subscriptions; nothing else to clean up.
}
