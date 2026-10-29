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
    { model: "Oven 3.8 Flash", cap: 500_000_000, tokensUsed: 321_700_000, periodEnd: "2026-11-01" },
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

function makeCtx({ key = null, cookieHeader = null, billing = freeBilling, quotaStatus = 200, body = quota } = {}) {
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
    format: { number: (value) => String(value) },
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

check("one bar per usable model, most used first, with named extras", async () => {
  const ctx = makeCtx({ key: "sk-test" });
  const snapshot = await manifest.fetchUsage(ctx);
  if (Math.abs(snapshot.primary.usedPercent - 64.34) > 0.01) throw new Error(`${snapshot.primary.usedPercent}`);
  if (snapshot.primary.title !== "Oven 3.8 Flash") throw new Error(snapshot.primary.title);
  const extras = (snapshot.extraWindows ?? []).map((window) => window.title);
  if (JSON.stringify(extras) !== JSON.stringify(["DeepSeek V4-Flash", "GLM 5.3 Flash", "Xiaomi MiMo V2.6 Flash"])) {
    throw new Error(`extras: ${JSON.stringify(extras)}`);
  }
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
  if (Math.abs(deepseek.progress - 1_400_000_000 / 3_000_000_000) > 1e-9) throw new Error("progress drift");
  if (rows[rows.length - 1] !== "GLM 5.3") throw new Error("unavailable rows are not last");
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
  const titles = [snapshot.primary, ...(snapshot.extraWindows ?? [])].map((window) => window.title);
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
