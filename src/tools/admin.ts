import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saveCredentials, type ServiceNowCredentials } from "../config.js";
import { invalidateTokens } from "../auth.js";
import { resolveHost } from "../host.js";
import { buildStatusPayload } from "../status.js";
import { ok, fail } from "../result.js";
import { runTool } from "./util.js";

export function registerAdminTools(server: McpServer): void {
  server.registerTool(
    "servicenow_set_credentials",
    {
      title: "Set ServiceNow credentials",
      description:
        "Save or update the ServiceNow connection credentials. Values are persisted to the env file and used for all subsequent requests. Provide any subset of fields.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "Instance host, e.g. 'dev12345' or 'dev12345.service-now.com'.",
          ),
        user: z.string().optional().describe("ServiceNow username."),
        password: z.string().optional().describe("ServiceNow password."),
      },
    },
    (args) =>
      runTool("servicenow_set_credentials", {}, () => {
        const clean: Partial<ServiceNowCredentials> = {};
        if (args.instance?.trim()) clean.instance = args.instance.trim();
        if (args.user?.trim()) clean.user = args.user.trim();
        if (args.password) clean.password = args.password;
        if (Object.keys(clean).length === 0) {
          return fail(
            "Provide at least one non-empty value: instance, user or password.",
          );
        }
        // Validate the host before persisting anything: an invalid or SSRF-
        // blocked instance should fail here, not at the first real request.
        if (clean.instance) {
          try {
            resolveHost(clean.instance);
          } catch (error) {
            return fail(error);
          }
        }
        const updated = saveCredentials(clean);
        // A cached OAuth token obtained with the old secrets must not survive
        // a credential change (the cache key has no password in it).
        invalidateTokens();
        return ok({
          message: "Credentials saved",
          instance: updated.instance,
          user: updated.user,
          password: "***",
        });
      }),
  );

  server.registerTool(
    "servicenow_get_status",
    {
      title: "Get ServiceNow connection status",
      description:
        "Show the configured instance, user, auth mode and access policy, and whether credentials are complete. The password is never revealed.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    () =>
      runTool("servicenow_get_status", {}, () => ok(buildStatusPayload())),
  );
}
