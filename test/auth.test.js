import test from "node:test";
import assert from "node:assert/strict";

import { queryTable } from "../build/api/table.js";
import { invalidateTokens, invalidateToken } from "../build/core/auth.js";
import { runWithProfile } from "../build/core/request-context.js";
import { baselineEnv, withEnv, realFetch } from "./helpers.js";

// OAuth password-grant configuration on top of the shared baseline. A unique
// client id keeps this file's token cache entry independent of other tests.
baselineEnv();
process.env.SN_AUTH = "oauth";
process.env.SN_OAUTH_CLIENT_ID = "client-abc";
process.env.SN_OAUTH_CLIENT_SECRET = "shhh";
process.env.SN_OAUTH_GRANT = "password";

test("OAuth: fetches a bearer token and caches it across requests", async () => {
  let tokenCalls = 0;
  let tableCalls = 0;

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/oauth_token.do")) {
      tokenCalls += 1;
      assert.equal(init.method, "POST");
      assert.match(init.headers["Content-Type"], /x-www-form-urlencoded/);
      assert.match(init.body, /grant_type=password/);
      assert.match(init.body, /client_id=client-abc/);
      return new Response(
        JSON.stringify({ access_token: "tok-123", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    tableCalls += 1;
    assert.equal(init.headers.Authorization, "Bearer tok-123");
    return new Response(JSON.stringify({ result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await queryTable({ table: "incident" });
    await queryTable({ table: "incident" });
    assert.equal(tokenCalls, 1, "token endpoint should be hit once (cached)");
    assert.equal(tableCalls, 2, "table endpoint should be hit per query");

    // After a credential change the cache must be dropped: the same key would
    // otherwise keep serving a token obtained with the old password.
    invalidateTokens();
    await queryTable({ table: "incident" });
    assert.equal(tokenCalls, 2, "invalidateTokens must force a fresh token");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("OAuth: a 401 with a cached token forces one re-auth and retries", async () => {
  invalidateTokens();
  let tokenCalls = 0;
  let tableCalls = 0;

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/oauth_token.do")) {
      tokenCalls += 1;
      return new Response(
        JSON.stringify({ access_token: `tok-${tokenCalls}`, expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    tableCalls += 1;
    // The first table call hits a server-side revoked token.
    if (init.headers.Authorization === "Bearer tok-1") {
      return new Response(JSON.stringify({ error: { message: "expired" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(init.headers.Authorization, "Bearer tok-2");
    return new Response(JSON.stringify({ result: [{ ok: true }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const { records } = await queryTable({ table: "incident" });
    assert.equal(records.length, 1);
    assert.equal(tokenCalls, 2, "the 401 must trigger exactly one re-auth");
    assert.equal(tableCalls, 2, "the request is retried once with a new token");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("OAuth: a second 401 surfaces as an error (no retry loop)", async () => {
  invalidateTokens();
  let tableCalls = 0;

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/oauth_token.do")) {
      return new Response(
        JSON.stringify({ access_token: "tok-x", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    tableCalls += 1;
    return new Response(JSON.stringify({ error: { message: "denied" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      queryTable({ table: "incident" }),
      (err) => err.status === 401,
    );
    assert.equal(tableCalls, 2, "exactly one forced retry, then the error");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("per-profile auth config overrides the global keys (ARCH-7)", async () => {
  // The default profile uses the global oauth client (client-abc); a non-default
  // profile must use its own SN_PROFILE_<NAME>_AUTH / _OAUTH_* per the MI-1
  // convention, not silently fall through to the global client.
  invalidateTokens();
  const tokenReqs = [];

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/oauth_token.do")) {
      tokenReqs.push({ host: new URL(u).host, body: String(init.body) });
      return new Response(
        JSON.stringify({ access_token: "prod-tok", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    assert.equal(init.headers.Authorization, "Bearer prod-tok");
    return new Response(JSON.stringify({ result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await withEnv(
      {
        SN_PROFILE_PROD_INSTANCE: "prodhost.service-now.com",
        SN_PROFILE_PROD_USER: "svc",
        SN_PROFILE_PROD_PASSWORD: "pw",
        SN_PROFILE_PROD_AUTH: "oauth",
        SN_PROFILE_PROD_OAUTH_CLIENT_ID: "prod-client",
        SN_PROFILE_PROD_OAUTH_CLIENT_SECRET: "prod-secret",
        SN_PROFILE_PROD_OAUTH_GRANT: "client_credentials",
      },
      () => runWithProfile("prod", () => queryTable({ table: "incident" })),
    );
    assert.equal(tokenReqs.length, 1, "the prod profile authenticates once");
    assert.equal(
      tokenReqs[0].host,
      "prodhost.service-now.com",
      "token request hits the profile's own host",
    );
    assert.match(
      tokenReqs[0].body,
      /client_id=prod-client/,
      "uses the profile's OAuth client id, not the global one",
    );
    assert.match(tokenReqs[0].body, /grant_type=client_credentials/);
  } finally {
    globalThis.fetch = realFetch;
    invalidateTokens();
  }
});

test("invalidateToken(host) drops only that host's token, not another's (QA-2)", async () => {
  invalidateTokens();
  const hostA = "dev00000.service-now.com";
  const hostB = "hostb.service-now.com";
  const tokenHosts = [];

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/oauth_token.do")) {
      tokenHosts.push(new URL(u).host);
      return new Response(
        JSON.stringify({ access_token: "tok", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    // Prime a cached token for each host (OAuth env persists via process.env).
    await queryTable({ table: "incident" });
    await withEnv({ SN_INSTANCE: hostB }, () =>
      queryTable({ table: "incident" }),
    );
    assert.deepEqual(tokenHosts, [hostA, hostB]);
    tokenHosts.length = 0;

    invalidateToken(hostA);

    await queryTable({ table: "incident" }); // host A must re-authenticate
    await withEnv({ SN_INSTANCE: hostB }, () =>
      queryTable({ table: "incident" }),
    ); // host B must still be cached
    assert.deepEqual(
      tokenHosts,
      [hostA],
      "only host A re-authenticates; host B's token survives",
    );
  } finally {
    globalThis.fetch = realFetch;
    invalidateTokens();
  }
});
