// Offline snapshot tests for nan-usage.ts.
//
// CodexBar loads this plugin inside its own sandbox, so the plugin is exercised here against a fake
// `ctx`: no network, no cookies, no CodexBar. Run with:
//   node --experimental-strip-types tests/snapshot.test.mjs
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const quota = {
  periodStart: "2026-10-01",
  models: [
    {
      model: "Oven 3.8 Flash",
      cap: 500_000_000,
      tokensUsed: 321_700_000,
      extraTokens: 125_000_000,
      extraUsable: true,
      extraExpiresAt: "2027-04-29T00:00:00.000Z",
      periodEnd: "2026-11-01",
    },
    { model: "DeepSeek V4-Flash", cap: 3_000_000_000, tokensUsed: 1_400_000_000, periodEnd: "2026-11-01" },
    { model: "Xiaomi MiMo V2.6 Flash", cap: 1_000_000_000, tokensUsed: 5_100_000, periodEnd: "2026-11-01" },
    { model: "GLM 5.3", cap: 0, tokensUsed: 0, windowHours: 4, periodEnd: "2026-11-01" },
    { model: "GLM 5.3 Flash", cap: 2_000_000_000, tokensUsed: 456_500_000, periodEnd: "2026-11-01" },
  ],
};

const premiumBilling = { subscription: { premium: true } };
const freeBilling = { subscription: { premium: false } };

const premiumQuota = {
  periodStart: "2026-10-01",
  models: [
    { model: "Oven 3.8 Flash", cap: 500_000_000, tokensUsed: 321_700_000, periodEnd: "2026-11-01" },
    { model: "GLM 5.3", cap: 3_000_000_000, tokensUsed: 0, windowHours: 4, periodEnd: "2026-11-01" },
  ],
};

const servedIDs = ["oven-3.8-flash", "deepseek-v4-flash", "xiaomi-mimo-v2.6-flash", "glm5.3", "glm5.3-flash"];

const retiredQuota = {
  periodStart: "2026-10-01",
  models: [
    { model: "Oven 3.8 Flash", cap: 500_000_000, tokensUsed: 321_700_000, periodEnd: "2026-11-01" },
    { model: "GLM 5.2", cap: 1_000_000_000, tokensUsed: 0, periodEnd: "2026-11-01" },
  ],
};

function makeCtx({
  key = null,
  cookieHeader = null,
  billing = freeBilling,
  quotaStatus = 200,
  body = quota,
  models = servedIDs,
  modelsStatus = 200,
} = {}) {
  const calls = [];
  return {
    calls,
    settings: {
      get: () => null,
      getSecret: (name) => (name === "API_KEY" ? key : null),
    },
    browser: {
      supportedBrowsers: "Chrome, Safari",
      availability: () => (cookieHeader ? "available" : "off"),
      rejectCookie: () => {
        calls.push({ reject: true });
      },
      async *sessions() {
        if (!cookieHeader) return;
        yield { id: "s1", header: cookieHeader, source: "chrome", origin: "nan.builders" };
      },
    },
    http: {
      async get(url, options = {}) {
        calls.push({ url, headers: options.headers ?? {} });
        if (url.endsWith("/api/usage/quota")) {
          return { status: quotaStatus, headers: {}, bodyText: JSON.stringify(body) };
        }
        if (url.endsWith("/v1/models")) {
          if (modelsStatus !== 200) return { status: modelsStatus, headers: {}, bodyText: "" };
          const data = models.map((id) => ({ id }));
          return { status: 200, headers: {}, bodyText: JSON.stringify({ data }) };
        }
        if (url.endsWith("/api/billing")) {
          return billing
            ? { status: 200, headers: {}, bodyText: JSON.stringify(billing) }
            : { status: 500, headers: {}, bodyText: "" };
        }
        return { status: 404, headers: {}, bodyText: "" };
      },
    },
    fail: {
      missingCredential: (message) => Object.assign(new Error(message), { kind: "missingCredential" }),
      parseFailure: (message) => Object.assign(new Error(message), { kind: "parseFailure" }),
      rateLimited: (message) => Object.assign(new Error(message), { kind: "rateLimited" }),
      providerUnavailable: (message) => Object.assign(new Error(message), { kind: "providerUnavailable" }),
      apiFailure: (message) => Object.assign(new Error(message), { kind: "apiFailure" }),
      authenticationExpired: (message) => Object.assign(new Error(message), { kind: "authenticationExpired" }),
    },
    date: {
      iso: (value) => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
      },
    },
    format: {
      number: (value) => String(value),
      monthDay: (value) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
      },
    },
    pct: (used, limit) => (limit > 0 ? Math.min(100, (used / limit) * 100) : 0),
    isDetailLabel: (value) => typeof value === "string" && value.trim().length > 0,
  };
}

async function loadPlugin() {
  globalThis.defineProvider = (manifest) => {
    globalThis.__manifest = manifest;
  };
  // Type stripping needs Node 22.6+ with --experimental-strip-types, or Node 23.6+ by default.
  await import(pathToFileURL(path.join(root, "nan-usage.ts")).href);
  return globalThis.__manifest;
}

const results = [];
function check(name, run) {
  results.push({ name, run });
}

const manifest = await loadPlugin();

check("manifest declares one HTTPS origin and a secure API key setting", () => {
  const origins = JSON.stringify(manifest.endpoints);
  if (!origins.includes("https://cloud-api.nan.builders")) throw new Error(`origins: ${origins}`);
  const setting = (manifest.settings ?? []).find((entry) => entry.key === "API_KEY");
  if (!setting) throw new Error("missing API_KEY setting");
  if (setting.type !== "secure") throw new Error(`API_KEY type ${setting.type}`);
});

check("manifest icon is an inline SVG within the host limits", () => {
  // 0x4934E1 is Helmcode's brand colour in CodexBar, and NaN shares the Helmcode platform.
  if (manifest.icon?.tint !== "#4934E1") throw new Error(`tint ${manifest.icon?.tint}`);
  const svg = manifest.icon?.svg ?? "";
  if (!svg.startsWith("<svg")) throw new Error("icon.svg missing");
  if (Buffer.byteLength(svg) > 8 * 1024) throw new Error("icon.svg exceeds 8 KiB");
  const elements = [...svg.matchAll(/<([a-zA-Z]+)/g)].map((match) => match[1]);
  const allowed = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "title", "desc"]);
  for (const element of elements) if (!allowed.has(element)) throw new Error(`element ${element}`);
  if (/url\(|style=|image|DOCTYPE/i.test(svg)) throw new Error("icon.svg contains a forbidden token");
});

check("API key authentication sends a bearer token and reads no cookie", async () => {
  const ctx = makeCtx({ key: "sk-test", cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  const quotaCall = ctx.calls.find((call) => call.url.endsWith("/api/usage/quota"));
  if (quotaCall.headers.Authorization !== "Bearer sk-test") throw new Error("no bearer header");
  if (quotaCall.headers.Cookie !== undefined) throw new Error("cookie sent beside the key");
  if (ctx.calls.some((call) => call.reject)) throw new Error("cookie rejected while the key worked");
  if (snapshot.identity.loginMethod !== "API key") throw new Error(`loginMethod ${snapshot.identity.loginMethod}`);
});

check("without a key the plugin falls back to dashboard cookies", async () => {
  const ctx = makeCtx({ cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  const quotaCall = ctx.calls.find((call) => call.url.endsWith("/api/usage/quota"));
  if (quotaCall.headers.Cookie !== "session=abc") throw new Error("cookie not sent");
  if (quotaCall.headers.Authorization !== undefined) throw new Error("authorization header without a key");
  if (snapshot.identity.loginMethod !== "Dashboard session") throw new Error(snapshot.identity.loginMethod);
});

check("with neither credential the error names both options", async () => {
  const ctx = makeCtx();
  let error;
  try {
    await manifest.fetchUsage(ctx);
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error("fetch succeeded without credentials");
  if (error.kind !== "missingCredential") throw new Error(`kind ${error.kind}`);
  if (!/API key/.test(error.message) || !/cloud\.nan\.builders/.test(error.message)) {
    throw new Error(`message: ${error.message}`);
  }
});

check("no top bar: every usable model is a named window instead", async () => {
  const ctx = makeCtx({ key: "sk-test" });
  const snapshot = await manifest.fetchUsage(ctx);
  if (snapshot.primary !== undefined) throw new Error("a top bar is still published");
  if (snapshot.secondary !== undefined || snapshot.tertiary !== undefined) throw new Error("extra top bars published");
  const extras = (snapshot.extraWindows ?? []).map((window) => window.title);
  if (JSON.stringify(extras) !== JSON.stringify([
    "Oven 3.8 Flash",
    "DeepSeek V4-Flash",
    "GLM 5.3 Flash",
    "Xiaomi MiMo V2.6 Flash",
  ])) {
    throw new Error(`extras: ${JSON.stringify(extras)}`);
  }
  const worst = snapshot.extraWindows[0].window;
  if (Math.abs(worst.usedPercent - 64.34) > 0.01) throw new Error(`${worst.usedPercent}`);
  if (snapshot.extraWindows.some((window) => window.title === "GLM 5.3")) {
    throw new Error("a premium tier the account lacks became a measured bar");
  }
});

check("detail rows carry the per-model breakdown the card renders", async () => {
  const ctx = makeCtx({ key: "sk-test" });
  const snapshot = await manifest.fetchUsage(ctx);
  const section = (snapshot.details ?? []).find((entry) => entry.title === "Modelos");
  if (!section) throw new Error("missing Modelos section");
  const rows = section.rows.map((row) => row.label);
  if (rows.length !== 5) throw new Error(`rows: ${JSON.stringify(rows)}`);
  const glm = section.rows.find((row) => row.label === "GLM 5.3");
  if (glm.progress !== null) throw new Error("unavailable model drew a progress bar");
  const deepseek = section.rows.find((row) => row.label === "DeepSeek V4-Flash");
  if (deepseek.value !== "1.4B / 3B") throw new Error(`value: ${deepseek.value}`);
  if (!/^reinicia /.test(deepseek.secondaryValue ?? "")) throw new Error(`reset line: ${deepseek.secondaryValue}`);
  if (Math.abs(deepseek.progress - 1_400_000_000 / 3_000_000_000) > 1e-9) throw new Error("progress drift");
  if (rows[rows.length - 1] !== "GLM 5.3") throw new Error("unavailable rows are not last");
});

check("an extra-usage pool shows its own expiry beside the model", async () => {
  const ctx = makeCtx({ key: "sk-test" });
  const snapshot = await manifest.fetchUsage(ctx);
  const oven = (snapshot.details ?? [])
    .find((entry) => entry.title === "Modelos").rows.find((row) => row.label === "Oven 3.8 Flash");
  const secondary = oven.secondaryValue ?? "";
  if (!secondary.includes("+125M extra")) throw new Error(`extra not shown: ${secondary}`);
  if (!secondary.includes("caduca")) throw new Error(`expiry missing: ${secondary}`);
  if (!secondary.includes("reinicia")) throw new Error(`reset missing: ${secondary}`);
});

check("a paused extra-usage pool says so instead of showing an expiry", async () => {
  const ctx = makeCtx({
    key: "sk-test",
    body: {
      periodStart: "2026-10-01",
      models: [{
        model: "Oven 3.8 Flash",
        cap: 500_000_000,
        tokensUsed: 500_000_000,
        extraTokens: 90_000_000,
        extraUsable: false,
        extraExpiresAt: "2027-04-29T00:00:00.000Z",
        periodEnd: "2026-11-01",
      }],
    },
  });
  const row = (await manifest.fetchUsage(ctx)).details
    .find((entry) => entry.title === "Modelos").rows[0];
  const secondary = row.secondaryValue ?? "";
  if (!secondary.includes("pausado")) throw new Error(`paused state missing: ${secondary}`);
  if (secondary.includes("caduca")) throw new Error(`expiry shown for a paused pool: ${secondary}`);
});

check("an exhausted base cap marks the extra pool as in use", async () => {
  const ctx = makeCtx({
    key: "sk-test",
    body: {
      periodStart: "2026-10-01",
      models: [{
        model: "Oven 3.8 Flash",
        cap: 500_000_000,
        tokensUsed: 500_000_000,
        extraTokens: 120_000_000,
        extraUsable: true,
        extraExpiresAt: "2027-04-29T00:00:00.000Z",
        periodEnd: "2026-11-01",
      }],
    },
  });
  const row = (await manifest.fetchUsage(ctx)).details
    .find((entry) => entry.title === "Modelos").rows[0];
  if (!(row.secondaryValue ?? "").includes("en uso")) throw new Error(`in-use marker missing: ${row.secondaryValue}`);
});

check("a premium tier is called out as requiring the subscription", async () => {
  const ctx = makeCtx({ key: "sk-test" });
  const snapshot = await manifest.fetchUsage(ctx);
  const section = (snapshot.details ?? []).find((entry) => entry.title === "Modelos");
  const glm = section.rows.find((row) => row.label === "GLM 5.3");
  if (glm.value !== "Requiere suscripción Plus") throw new Error(glm.value);
  const account = (snapshot.details ?? []).find((entry) => entry.title === "Cuenta");
  const premium = account.rows.find((row) => row.label === "Suscripción premium");
  if (premium.value !== "No activa") throw new Error(premium.value);
});

check("a paid account gets the rolling premium window as a real bar", async () => {
  const ctx = makeCtx({ key: "sk-test", billing: premiumBilling, body: premiumQuota });
  const snapshot = await manifest.fetchUsage(ctx);
  const titles = (snapshot.extraWindows ?? []).map((window) => window.title);
  if (!titles.includes("GLM 5.3")) throw new Error(`titles: ${JSON.stringify(titles)}`);
  const glm = snapshot.extraWindows.find((window) => window.title === "GLM 5.3");
  if (glm.window.windowMinutes !== 240) throw new Error(`windowMinutes ${glm.window.windowMinutes}`);
});

check("a rejected key names the key, a rejected cookie names the session", async () => {
  const keyCtx = makeCtx({ key: "sk-test", quotaStatus: 401 });
  let keyError;
  try {
    await manifest.fetchUsage(keyCtx);
  } catch (caught) {
    keyError = caught;
  }
  if (keyError?.kind !== "authenticationExpired") throw new Error(`key kind ${keyError?.kind}`);
  if (!/API key/.test(keyError.message)) throw new Error(keyError.message);

  const cookieCtx = makeCtx({ cookieHeader: "session=abc", quotaStatus: 401 });
  let cookieError;
  try {
    await manifest.fetchUsage(cookieCtx);
  } catch (caught) {
    cookieError = caught;
  }
  if (cookieError?.kind !== "authenticationExpired") throw new Error(`cookie kind ${cookieError?.kind}`);
  if (!cookieCtx.calls.some((call) => call.reject)) throw new Error("rejected cookie was not evicted");
});

check("a retired model is dropped when the served list disagrees", async () => {
  const ctx = makeCtx({ key: "sk-test", body: retiredQuota });
  const snapshot = await manifest.fetchUsage(ctx);
  const quotaCall = ctx.calls.find((call) => call.url.endsWith("/v1/models"));
  if (!quotaCall) throw new Error("the served list was never requested");
  if (quotaCall.headers.Authorization !== "Bearer sk-test") throw new Error("served list sent without the key");
  const titles = (snapshot.extraWindows ?? []).map((window) => window.title);
  if (titles.includes("GLM 5.2")) throw new Error(`retired model kept: ${JSON.stringify(titles)}`);
  const rows = (snapshot.details ?? []).find((entry) => entry.title === "Modelos").rows.map((row) => row.label);
  if (rows.includes("GLM 5.2")) throw new Error(`retired model kept in details: ${JSON.stringify(rows)}`);
  if (!rows.includes("Oven 3.8 Flash")) throw new Error(`served model dropped: ${JSON.stringify(rows)}`);
});

check("a cookie session keeps the payload as reported, since it cannot ask", async () => {
  const ctx = makeCtx({ cookieHeader: "session=abc", body: retiredQuota });
  const snapshot = await manifest.fetchUsage(ctx);
  if (ctx.calls.some((call) => call.url.endsWith("/v1/models"))) throw new Error("cookie session queried /v1/models");
  const rows = (snapshot.details ?? []).find((entry) => entry.title === "Modelos").rows.map((row) => row.label);
  if (!rows.includes("GLM 5.2")) throw new Error(`payload was filtered: ${JSON.stringify(rows)}`);
});

check("an unreadable served list fails open instead of hiding everything", async () => {
  const ctx = makeCtx({ key: "sk-test", body: retiredQuota, modelsStatus: 500 });
  const snapshot = await manifest.fetchUsage(ctx);
  const rows = (snapshot.details ?? []).find((entry) => entry.title === "Modelos").rows.map((row) => row.label);
  if (!rows.includes("GLM 5.2")) throw new Error(`rows: ${JSON.stringify(rows)}`);
});

check("a naming disagreement fails open rather than blanking the card", async () => {
  const ctx = makeCtx({ key: "sk-test", body: retiredQuota, models: ["something-else-entirely"] });
  const snapshot = await manifest.fetchUsage(ctx);
  if ((snapshot.extraWindows ?? []).length === 0) throw new Error("every model was dropped");
});

let failed = 0;
for (const { name, run } of results) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
