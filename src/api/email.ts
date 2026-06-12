import { snRequest } from "../core/http.js";
import { assertWriteAllowed } from "../core/policy.js";
import { expectResult } from "./shared.js";
import { pluginCall } from "./plugin.js";

/**
 * ServiceNow Email API (`/api/now/email`). Wrapped in pluginCall because the
 * API requires an activated plugin on some instances.
 */

export interface SendEmailArgs {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  /** Optional record to associate the email with. */
  table?: string;
  sysId?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<unknown> {
  assertWriteAllowed("send email");
  return pluginCall("Email", async () => {
    const { data } = await snRequest<{ result: unknown }>({
      method: "POST",
      path: "/api/now/email",
      body: {
        to: args.to.join(","),
        subject: args.subject,
        text: args.body,
        ...(args.cc?.length ? { cc: args.cc.join(",") } : {}),
        ...(args.bcc?.length ? { bcc: args.bcc.join(",") } : {}),
        ...(args.table ? { table_name: args.table } : {}),
        ...(args.sysId ? { table_record_id: args.sysId } : {}),
      },
    });
    return expectResult(data, "Email API");
  });
}

export async function getEmail(sysId: string): Promise<unknown> {
  return pluginCall("Email", async () => {
    const { data } = await snRequest<{ result: unknown }>({
      method: "GET",
      path: `/api/now/email/${encodeURIComponent(sysId)}`,
    });
    return expectResult(data, "Email API");
  });
}
