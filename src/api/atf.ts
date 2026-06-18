import { snRequest } from "../core/http.js";
import { assertWriteAllowed } from "../core/policy.js";
import { expectResult, expectResultArray, snString } from "./shared.js";
import { pluginCall } from "./plugin.js";
import type { SnRecord } from "./table.js";

/**
 * Automated Test Framework (ATF) execution (Phase 8, package `atf`). Listing is
 * a plain Table API read; running tests goes through the CI/CD API
 * (`/api/sn_cicd/...`, the `sn_cicd` plugin) and **executes code on the
 * instance** — so the run tools are not read-only and the package never enters
 * the default profile. Exact CI/CD paths can vary by instance version; calls are
 * wrapped in {@link pluginCall} so an inactive plugin reports clearly.
 */

const LABEL = "CI/CD";

export interface AtfQuery {
  query?: string;
  active?: boolean;
  limit?: number;
}

export interface AtfTestSummary extends SnRecord {
  sys_id?: string;
  name?: string;
  active?: string;
}

/** List ATF tests (`sys_atf_test`). */
export async function listAtfTests(
  opts: AtfQuery = {},
): Promise<AtfTestSummary[]> {
  const clauses: string[] = [];
  if (opts.active !== undefined) clauses.push(`active=${opts.active}`);
  if (opts.query?.trim()) clauses.push(opts.query.trim());
  clauses.push("ORDERBYname");
  const params = new URLSearchParams({
    sysparm_query: clauses.join("^"),
    sysparm_fields: "sys_id,name,active,description",
    sysparm_limit: String(opts.limit ?? 50),
    sysparm_display_value: "false",
  });
  const { data } = await snRequest<{ result: AtfTestSummary[] }>({
    method: "GET",
    path: "/api/now/table/sys_atf_test",
    params,
  });
  return expectResultArray(data, "ATF");
}

/** List ATF test suites (`sys_atf_test_suite`). */
export async function listAtfSuites(
  opts: AtfQuery = {},
): Promise<AtfTestSummary[]> {
  const clauses: string[] = [];
  if (opts.active !== undefined) clauses.push(`active=${opts.active}`);
  if (opts.query?.trim()) clauses.push(opts.query.trim());
  clauses.push("ORDERBYname");
  const params = new URLSearchParams({
    sysparm_query: clauses.join("^"),
    sysparm_fields: "sys_id,name,active,description",
    sysparm_limit: String(opts.limit ?? 50),
    sysparm_display_value: "false",
  });
  const { data } = await snRequest<{ result: AtfTestSummary[] }>({
    method: "GET",
    path: "/api/now/table/sys_atf_test_suite",
    params,
  });
  return expectResultArray(data, "ATF");
}

export interface AtfRun {
  executionId?: string;
  status?: string;
  statusLabel?: string;
  statusMessage?: string;
  percentComplete?: number;
  progressUrl?: string;
}

interface CicdResult {
  status?: string;
  status_label?: string;
  status_message?: string;
  percent_complete?: number | string;
  links?: { progress?: { id?: string; url?: string } };
}

function toRun(result: CicdResult): AtfRun {
  const pct = Number(snString(result.percent_complete));
  return {
    executionId: result.links?.progress?.id,
    status: snString(result.status) || undefined,
    statusLabel: snString(result.status_label) || undefined,
    statusMessage: snString(result.status_message) || undefined,
    percentComplete: Number.isFinite(pct) ? pct : undefined,
    progressUrl: result.links?.progress?.url,
  };
}

/**
 * Run an ATF test suite via the CI/CD API. Returns the execution/progress id to
 * poll with {@link getAtfResult}. A write (executes on the instance).
 */
export async function runAtfSuite(suiteSysId: string): Promise<AtfRun> {
  assertWriteAllowed("run ATF suite");
  return pluginCall(LABEL, async () => {
    const params = new URLSearchParams({ sys_id: suiteSysId });
    const { data } = await snRequest<{ result: CicdResult }>({
      method: "POST",
      path: "/api/sn_cicd/testsuite/run",
      params,
    });
    return toRun(expectResult(data, "CI/CD ATF"));
  });
}

/**
 * Run a single ATF test via the CI/CD API. Note: ServiceNow's CI/CD surface is
 * suite-oriented; on instances without a single-test endpoint, run the suite
 * that contains the test instead. A write (executes on the instance).
 */
export async function runAtfTest(testSysId: string): Promise<AtfRun> {
  assertWriteAllowed("run ATF test");
  return pluginCall(LABEL, async () => {
    const params = new URLSearchParams({ test_sys_id: testSysId });
    const { data } = await snRequest<{ result: CicdResult }>({
      method: "POST",
      path: "/api/sn_cicd/testsuite/run",
      params,
    });
    return toRun(expectResult(data, "CI/CD ATF"));
  });
}

/** Poll an ATF execution's progress/result by its execution (progress) id. */
export async function getAtfResult(executionId: string): Promise<AtfRun> {
  return pluginCall(LABEL, async () => {
    const { data } = await snRequest<{ result: CicdResult }>({
      method: "GET",
      path: `/api/sn_cicd/progress/${encodeURIComponent(executionId)}`,
    });
    return toRun(expectResult(data, "CI/CD ATF"));
  });
}
