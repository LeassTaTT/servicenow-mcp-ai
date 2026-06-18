import test from "node:test";
import assert from "node:assert/strict";

import {
  listCatalogs,
  orderCatalogItem,
  listCatalogCategories,
  listCatalogItems,
  getCatalogItem,
} from "../build/api/catalog.js";
import {
  createChange,
  changeConflicts,
  listChanges,
  getChange,
  updateChange,
} from "../build/api/change.js";
import {
  searchKnowledge,
  getKnowledgeArticle,
  knowledgeHighlights,
} from "../build/api/knowledge.js";
import {
  getCmdbInstance,
  createCmdbInstance,
  listCmdbInstances,
  updateCmdbInstance,
  getCmdbMeta,
} from "../build/api/cmdb.js";
import { clearSchemaCache } from "../build/core/cache.js";
import { ServiceNowError } from "../build/core/errors.js";
import { baselineEnv, withFetch, jsonResponse } from "./helpers.js";

baselineEnv();

// --- Service Catalog ---------------------------------------------------------

test("listCatalogs reads the Service Catalog catalogs endpoint", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/api\/sn_sc\/servicecatalog\/catalogs$/);
      return jsonResponse(200, { result: [{ sys_id: "c1" }] });
    },
    async () => {
      const result = await listCatalogs();
      assert.deepEqual(result, [{ sys_id: "c1" }]);
    },
  );
});

test("orderCatalogItem posts order_now with the quantity", async () => {
  await withFetch(
    (url, init) => {
      assert.match(url, /\/items\/item123\/order_now$/);
      const body = JSON.parse(init.body);
      assert.equal(body.sysparm_quantity, "2");
      assert.deepEqual(body.variables, { size: "L" });
      return jsonResponse(200, { result: { number: "REQ001" } });
    },
    async () => {
      const result = await orderCatalogItem({
        itemSysId: "item123",
        quantity: 2,
        variables: { size: "L" },
      });
      assert.deepEqual(result, { number: "REQ001" });
    },
  );
});

test("read-only mode blocks a catalog order before any request", async () => {
  process.env.SN_READONLY = "true";
  try {
    await withFetch(
      () => {
        throw new Error("fetch should not run in read-only mode");
      },
      async (calls) => {
        await assert.rejects(
          orderCatalogItem({ itemSysId: "x" }),
          (err) => err instanceof ServiceNowError && err.status === 403,
        );
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    delete process.env.SN_READONLY;
  }
});

test("a 404 from a plugin API is annotated as possibly inactive", async () => {
  await withFetch(
    () => jsonResponse(404, { error: { message: "Not found" } }),
    async () => {
      await assert.rejects(
        listCatalogs(),
        (err) =>
          err instanceof ServiceNowError &&
          err.status === 404 &&
          /may not be active/i.test(err.message),
      );
    },
  );
});

test("listCatalogCategories targets the catalog's categories endpoint (QA-16)", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/servicecatalog\/catalogs\/cat1\/categories$/);
      return jsonResponse(200, { result: [{ sys_id: "c1" }] });
    },
    async () => {
      const result = await listCatalogCategories("cat1");
      assert.deepEqual(result, [{ sys_id: "c1" }]);
    },
  );
});

test("listCatalogItems passes text/category/limit/offset as sysparm params (QA-16)", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/servicecatalog\/items\?/);
      const p = new URL(url).searchParams;
      assert.equal(p.get("sysparm_text"), "laptop");
      assert.equal(p.get("sysparm_category"), "hardware");
      assert.equal(p.get("sysparm_limit"), "5");
      assert.equal(p.get("sysparm_offset"), "10");
      return jsonResponse(200, { result: [{ sys_id: "i1" }] });
    },
    async () => {
      const result = await listCatalogItems({
        text: "laptop",
        category: "hardware",
        limit: 5,
        offset: 10,
      });
      assert.deepEqual(result, [{ sys_id: "i1" }]);
    },
  );
});

test("getCatalogItem reads a single item by sys_id (QA-16)", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/servicecatalog\/items\/item9$/);
      return jsonResponse(200, { result: { sys_id: "item9", name: "Laptop" } });
    },
    async () => {
      const result = await getCatalogItem("item9");
      assert.equal(result.name, "Laptop");
    },
  );
});

// --- Change Management -------------------------------------------------------

test("createChange normal posts to the normal endpoint", async () => {
  await withFetch(
    (url, init) => {
      assert.match(url, /\/api\/sn_chg_rest\/change\/normal$/);
      const body = JSON.parse(init.body);
      assert.equal(body.short_description, "Patch");
      return jsonResponse(200, { result: { number: "CHG001" } });
    },
    async () => {
      const result = await createChange({
        type: "normal",
        fields: { short_description: "Patch" },
      });
      assert.deepEqual(result, { number: "CHG001" });
    },
  );
});

test("a standard change without a template id is rejected", async () => {
  await withFetch(
    () => {
      throw new Error("fetch should not run when validation fails");
    },
    async (calls) => {
      await assert.rejects(
        createChange({ type: "standard", fields: {} }),
        (err) => err instanceof ServiceNowError,
      );
      assert.equal(calls.length, 0);
    },
  );
});

test("recalculating change conflicts is blocked in read-only mode", async () => {
  process.env.SN_READONLY = "true";
  try {
    await withFetch(
      () => {
        throw new Error("fetch should not run in read-only mode");
      },
      async (calls) => {
        await assert.rejects(
          changeConflicts("chg1", true),
          (err) => err instanceof ServiceNowError && err.status === 403,
        );
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    delete process.env.SN_READONLY;
  }
});

test("reading change conflicts uses GET and is allowed read-only", async () => {
  process.env.SN_READONLY = "true";
  try {
    await withFetch(
      (url, init) => {
        assert.equal(init.method, "GET");
        assert.match(url, /\/change\/chg1\/conflict$/);
        return jsonResponse(200, { result: [] });
      },
      async () => {
        const result = await changeConflicts("chg1", false);
        assert.deepEqual(result, []);
      },
    );
  } finally {
    delete process.env.SN_READONLY;
  }
});

// --- Knowledge ---------------------------------------------------------------

test("searchKnowledge passes the search term as sysparm_search", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/api\/sn_km_api\/knowledge\/articles/);
      assert.match(url, /sysparm_search=vpn/);
      return jsonResponse(200, { result: { articles: [] } });
    },
    async () => {
      await searchKnowledge({ search: "vpn", limit: 5 });
    },
  );
});

test("getKnowledgeArticle reads a single article by sys_id", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/knowledge\/articles\/kb123$/);
      return jsonResponse(200, { result: { sys_id: "kb123" } });
    },
    async () => {
      const result = await getKnowledgeArticle("kb123");
      assert.deepEqual(result, { sys_id: "kb123" });
    },
  );
});

test("knowledgeHighlights hits the featured/most_viewed endpoint with a limit (QA-16)", async () => {
  for (const mode of ["featured", "most_viewed"]) {
    await withFetch(
      (url) => {
        assert.match(url, new RegExp(`/knowledge/articles/${mode}\\?`));
        assert.equal(new URL(url).searchParams.get("sysparm_limit"), "3");
        return jsonResponse(200, { result: [{ sys_id: `${mode}-1` }] });
      },
      async () => {
        const result = await knowledgeHighlights(mode, 3);
        assert.deepEqual(result, [{ sys_id: `${mode}-1` }]);
      },
    );
  }
});

// --- CMDB --------------------------------------------------------------------

test("getCmdbInstance targets the class-aware instance endpoint", async () => {
  await withFetch(
    (url) => {
      assert.match(url, /\/api\/now\/cmdb\/instance\/cmdb_ci_server\/ci1$/);
      return jsonResponse(200, { result: { sys_id: "ci1" } });
    },
    async () => {
      const result = await getCmdbInstance("cmdb_ci_server", "ci1");
      assert.deepEqual(result, { sys_id: "ci1" });
    },
  );
});

test("createCmdbInstance wraps attributes and source in the body", async () => {
  await withFetch(
    (url, init) => {
      assert.match(url, /\/cmdb\/instance\/cmdb_ci_server$/);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.attributes, { name: "host01" });
      assert.equal(body.source, "ServiceNow");
      return jsonResponse(200, { result: { sys_id: "ci2" } });
    },
    async () => {
      const result = await createCmdbInstance({
        className: "cmdb_ci_server",
        attributes: { name: "host01" },
        source: "ServiceNow",
      });
      assert.deepEqual(result, { sys_id: "ci2" });
    },
  );
});

test("a denied CMDB class blocks the request before any fetch", async () => {
  process.env.SN_TABLES_DENY = "cmdb_ci_server";
  try {
    await withFetch(
      () => {
        throw new Error("fetch should not run for a denied class");
      },
      async (calls) => {
        await assert.rejects(
          getCmdbInstance("cmdb_ci_server", "ci1"),
          (err) => err instanceof ServiceNowError && err.status === 403,
        );
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    delete process.env.SN_TABLES_DENY;
  }
});

// --- Change Management: read + update paths (QA-21) --------------------------

test("listChanges passes query/limit/offset/fields as sysparm params (QA-21)", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(init.method, "GET");
      assert.match(url, /\/api\/sn_chg_rest\/change\?/);
      const p = new URL(url).searchParams;
      assert.equal(p.get("sysparm_query"), "active=true");
      assert.equal(p.get("sysparm_limit"), "5");
      assert.equal(p.get("sysparm_offset"), "10");
      assert.equal(p.get("sysparm_fields"), "number,short_description");
      return jsonResponse(200, { result: [{ number: "CHG100" }] });
    },
    async () => {
      const result = await listChanges({
        query: "active=true",
        limit: 5,
        offset: 10,
        fields: ["number", "short_description"],
      });
      assert.deepEqual(result, [{ number: "CHG100" }]);
    },
  );
});

test("getChange reads a single change by sys_id (QA-21)", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(init.method, "GET");
      assert.match(url, /\/api\/sn_chg_rest\/change\/chg9$/);
      return jsonResponse(200, { result: { sys_id: "chg9" } });
    },
    async () => {
      const result = await getChange("chg9");
      assert.deepEqual(result, { sys_id: "chg9" });
    },
  );
});

test("updateChange PATCHes the change endpoint with the fields (QA-21)", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(init.method, "PATCH");
      assert.match(url, /\/api\/sn_chg_rest\/change\/chg9$/);
      assert.deepEqual(JSON.parse(init.body), { state: "review" });
      return jsonResponse(200, { result: { sys_id: "chg9", state: "review" } });
    },
    async () => {
      const result = await updateChange("chg9", { state: "review" });
      assert.deepEqual(result, { sys_id: "chg9", state: "review" });
    },
  );
});

test("updateChange is blocked in read-only mode before any request (QA-21)", async () => {
  process.env.SN_READONLY = "true";
  try {
    await withFetch(
      () => {
        throw new Error("fetch should not run in read-only mode");
      },
      async (calls) => {
        await assert.rejects(
          updateChange("chg9", { state: "review" }),
          (err) => err instanceof ServiceNowError && err.status === 403,
        );
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    delete process.env.SN_READONLY;
  }
});

// --- CMDB: list + update + meta cache (QA-22) --------------------------------

test("listCmdbInstances passes query/limit/offset to the class endpoint (QA-22)", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(init.method, "GET");
      assert.match(url, /\/api\/now\/cmdb\/instance\/cmdb_ci_server\?/);
      const p = new URL(url).searchParams;
      assert.equal(p.get("sysparm_query"), "operational_status=1");
      assert.equal(p.get("sysparm_limit"), "20");
      assert.equal(p.get("sysparm_offset"), "5");
      return jsonResponse(200, { result: [{ sys_id: "ci1" }] });
    },
    async () => {
      const result = await listCmdbInstances("cmdb_ci_server", {
        query: "operational_status=1",
        limit: 20,
        offset: 5,
      });
      assert.deepEqual(result, [{ sys_id: "ci1" }]);
    },
  );
});

test("updateCmdbInstance PATCHes through IRE with attributes + source (QA-22)", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(init.method, "PATCH");
      assert.match(url, /\/cmdb\/instance\/cmdb_ci_server\/ci1$/);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.attributes, { name: "host02" });
      assert.equal(body.source, "ServiceNow");
      return jsonResponse(200, { result: { sys_id: "ci1" } });
    },
    async () => {
      const result = await updateCmdbInstance("ci1", {
        className: "cmdb_ci_server",
        attributes: { name: "host02" },
        source: "ServiceNow",
      });
      assert.deepEqual(result, { sys_id: "ci1" });
    },
  );
});

test("updateCmdbInstance is blocked in read-only mode before any request (QA-22)", async () => {
  process.env.SN_READONLY = "true";
  try {
    await withFetch(
      () => {
        throw new Error("fetch should not run in read-only mode");
      },
      async (calls) => {
        await assert.rejects(
          updateCmdbInstance("ci1", {
            className: "cmdb_ci_server",
            attributes: { name: "x" },
          }),
          (err) => err instanceof ServiceNowError && err.status === 403,
        );
        assert.equal(calls.length, 0);
      },
    );
  } finally {
    delete process.env.SN_READONLY;
  }
});

test("getCmdbMeta reads the meta endpoint and caches the result (QA-22)", async () => {
  clearSchemaCache();
  let metaCalls = 0;
  try {
    await withFetch(
      (url) => {
        metaCalls += 1;
        assert.match(url, /\/api\/now\/cmdb\/meta\/cmdb_ci_server$/);
        return jsonResponse(200, { result: { attributes: [] } });
      },
      async () => {
        const a = await getCmdbMeta("cmdb_ci_server");
        const b = await getCmdbMeta("cmdb_ci_server");
        assert.deepEqual(a, b);
        assert.equal(metaCalls, 1, "the second read is served from cache");
      },
    );
  } finally {
    clearSchemaCache();
  }
});
