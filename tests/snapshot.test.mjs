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

const retiredQuota = {
  periodStart: "2026-10-01",
  models: [
    { model: "Oven 3.8 Flash", cap: 500_000_000, tokensUsed: 321_700_000, periodEnd: "2026-11-01" },
    { model: "GLM 5.2", cap: 1_000_000_000, tokensUsed: 0, periodEnd: "2026-11-01" },
  ],
};

function makeCtx({
  store = new Map(),
  storageThrows = false,
  cookieHeader = "session=abc",
  manualCookie = null,
  sessions = null,
  billing = freeBilling,
  quotaStatus = 200,
  body = quota,
  credits = null,
  creditsStatus = credits ? 200 : 404,
  onCreditsGet = null,
  onQuotaGet = null,
} = {}) {
  const resolvedSessions = sessions ?? (cookieHeader
    ? [{ id: "s1", header: cookieHeader, source: "chrome", origin: "nan.builders" }]
    : []);
  const calls = [];
  return {
    calls,
    storage: {
      get: (name) => {
        if (storageThrows) throw new Error("storage unavailable");
        return store.has(name) ? store.get(name) : null;
      },
      set: (name, value) => {
        if (storageThrows) throw new Error("storage unavailable");
        store.set(name, value);
      },
      remove: (name) => store.delete(name),
    },
    store,
    settings: {
      get: () => null,
      getSecret: (key) => (key === "SESSION_COOKIE" && manualCookie ? manualCookie : null),
    },
    browser: {
      supportedBrowsers: "Chrome, Safari",
      availability: () => (resolvedSessions.length > 0 ? "available" : "off"),
      rejectCookie: () => {
        calls.push({ reject: true });
      },
      async *sessions() {
        for (const session of resolvedSessions) yield session;
      },
    },
    http: {
      async get(url, options = {}) {
        calls.push({ url, headers: options.headers ?? {} });
        if (url.endsWith("/api/usage/credits")) {
          if (onCreditsGet) return onCreditsGet(options);
          return { status: creditsStatus, headers: {}, bodyText: credits ? JSON.stringify(credits) : "" };
        }
        if (url.endsWith("/api/usage/quota")) {
          if (onQuotaGet) return onQuotaGet(options);
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
    format: {
      number: (value) => String(value),
      monthDay: (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new TypeError("invalid date");
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[date.getMonth()]} ${date.getDate()}`;
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

check("manifest declares one HTTPS origin, a secure manual-cookie setting and plugin capabilities", () => {
  const origins = JSON.stringify(manifest.endpoints);
  if (!origins.includes("https://cloud-api.nan.builders")) throw new Error(`origins: ${origins}`);
  const capabilities = JSON.stringify(manifest.capabilities ?? []);
  if (!capabilities.includes("persistent-storage")) throw new Error(`capabilities: ${capabilities}`);
  if (!capabilities.includes("browser-cookies")) throw new Error(`capabilities: ${capabilities}`);
  const settings = manifest.settings ?? [];
  if (!Array.isArray(settings) || settings.length !== 1) throw new Error(`settings: ${JSON.stringify(settings)}`);
  if (settings[0].key !== "SESSION_COOKIE") throw new Error(`setting key: ${settings[0].key}`);
  if (settings[0].type !== "secure") throw new Error(`setting type: ${settings[0].type}`);
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

check("dashboard session authentication sends a cookie and declares the browser source", async () => {
  const ctx = makeCtx({ cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  const quotaCall = ctx.calls.find((call) => call.url.endsWith("/api/usage/quota"));
  if (quotaCall.headers.Cookie !== "session=abc") throw new Error("cookie not sent");
  if (snapshot.identity.loginMethod !== "Dashboard session (Chrome)") throw new Error(snapshot.identity.loginMethod);
});

check("without credentials the error guides the user to sign in", async () => {
  const ctx = makeCtx({ cookieHeader: null });
  let error;
  try {
    await manifest.fetchUsage(ctx);
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error("fetch succeeded without credentials");
  if (error.kind !== "missingCredential") throw new Error(`kind ${error.kind}`);
  if (!/cloud\.nan\.builders/.test(error.message)) {
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
  const rows = section.rows.map((row) => row.label).filter((label) => label !== "+ extra");
  if (rows.length !== 5) throw new Error(`model rows: ${JSON.stringify(rows)}`);
  const glm = section.rows.find((row) => row.label === "GLM 5.3");
  if (glm.progress !== null) throw new Error("unavailable model drew a progress bar");
  const deepseek = section.rows.find((row) => row.label === "DeepSeek V4-Flash");
  if (deepseek.value !== "1.4B / 3B") throw new Error(`value: ${deepseek.value}`);
  if (!/^reinicia /.test(deepseek.secondaryValue ?? "")) throw new Error(`reset line: ${deepseek.secondaryValue}`);
  if (Math.abs(deepseek.progress - 1_400_000_000 / 3_000_000_000) > 1e-9) throw new Error("progress drift");
  if (rows[rows.length - 1] !== "GLM 5.3") throw new Error("unavailable rows are not last");
});

check("an extra-usage pool is its own bar under the model", async () => {
  const ctx = makeCtx({ key: "sk-test" });
  const snapshot = await manifest.fetchUsage(ctx);
  const rows = (snapshot.details ?? []).find((entry) => entry.title === "Modelos").rows;
  const modelIndex = rows.findIndex((row) => row.label === "Oven 3.8 Flash");
  if (modelIndex < 0) throw new Error("model row missing");
  const base = rows[modelIndex];
  const extra = rows[modelIndex + 1];
  if (extra?.label !== "+ extra") throw new Error(`extra row not directly below: ${extra?.label}`);
  if (base.value !== "321.7M / 500M") throw new Error(`base value: ${base.value}`);
  if (!/^reinicia /.test(base.secondaryValue ?? "")) throw new Error(`reset line: ${base.secondaryValue}`);
  if ((base.secondaryValue ?? "").includes("extra")) throw new Error("the pool leaked into the model line");
  if (!/^125M restantes/.test(extra.value)) throw new Error(`extra value: ${extra.value}`);
  if (!/caduca Apr 29 2027/.test(extra.value)) throw new Error(`expiry missing its year: ${extra.value}`);
  // Nothing has been spent from the pool yet, so its bar is full.
  if (extra.progress !== 1) throw new Error(`untouched pool is not full: ${extra.progress}`);
  const count = rows.filter((row) => row.label === "+ extra").length;
  if (count !== 1) throw new Error(`only one pool was bought, found ${count} extra rows`);
});

check("a drained pool shrinks against the size it was first seen at", async () => {
  const store = new Map();
  const pool = (extraTokens) => makeCtx({
    store,
    key: "sk-test",
    body: {
      periodStart: "2026-10-01",
      models: [{
        model: "Oven 3.8 Flash",
        cap: 500_000_000,
        tokensUsed: 100_000_000,
        extraTokens,
        extraUsable: true,
        extraExpiresAt: "2027-04-29T00:00:00.000Z",
        periodEnd: "2026-11-01",
      }],
    },
  });
  const full = await manifest.fetchUsage(pool(125_000_000));
  const fullExtra = full.details.find((entry) => entry.title === "Modelos").rows.find((row) => row.label === "+ extra");
  if (fullExtra.progress !== 1) throw new Error(`first sight not full: ${fullExtra.progress}`);
  const half = await manifest.fetchUsage(pool(62_500_000));
  const halfExtra = half.details.find((entry) => entry.title === "Modelos").rows.find((row) => row.label === "+ extra");
  if (Math.abs(halfExtra.progress - 0.5) > 1e-9) throw new Error(`drained pool: ${halfExtra.progress}`);
  if (!halfExtra.value.includes("62.5M restantes")) throw new Error(`value: ${halfExtra.value}`);
});

check("a new expiry date starts a fresh pool at full", async () => {
  const store = new Map();
  store.set("nan-extra:Oven 3.8 Flash:2027-04-29T00:00:00.000Z", "500000000");
  const ctx = makeCtx({
    store,
    key: "sk-test",
    body: {
      periodStart: "2026-10-01",
      models: [{
        model: "Oven 3.8 Flash",
        cap: 500_000_000,
        tokensUsed: 100_000_000,
        extraTokens: 90_000_000,
        extraUsable: true,
        extraExpiresAt: "2028-01-15T00:00:00.000Z",
        periodEnd: "2026-11-01",
      }],
    },
  });
  const extra = (await manifest.fetchUsage(ctx)).details
    .find((entry) => entry.title === "Modelos").rows.find((row) => row.label === "+ extra");
  if (extra.progress !== 1) throw new Error(`new expiry inherited an old pool: ${extra.progress}`);
});

check("storage being unavailable leaves the pool full instead of failing", async () => {
  const ctx = makeCtx({ key: "sk-test", storageThrows: true });
  const snapshot = await manifest.fetchUsage(ctx);
  const extra = snapshot.details.find((entry) => entry.title === "Modelos").rows.find((row) => row.label === "+ extra");
  if (extra.progress !== 1) throw new Error(`progress without storage: ${extra.progress}`);
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
  const rows = (await manifest.fetchUsage(ctx)).details
    .find((entry) => entry.title === "Modelos").rows;
  const extra = rows.find((row) => row.label === "+ extra");
  if (!extra) throw new Error("no extra row");
  if (!extra.value.includes("pausado")) throw new Error(`paused state missing: ${extra.value}`);
  if (extra.value.includes("caduca")) throw new Error(`expiry shown for a paused pool: ${extra.value}`);
  if (extra.progress !== null) throw new Error(`a paused pool drew a bar: ${extra.progress}`);
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
  const extra = (await manifest.fetchUsage(ctx)).details
    .find((entry) => entry.title === "Modelos").rows.find((row) => row.label === "+ extra");
  if (!(extra?.value ?? "").includes("en uso")) throw new Error(`in-use marker missing: ${extra?.value}`);
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

check("a rejected cookie evicts the session", async () => {
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

check("a retired model is filtered out", async () => {
  const ctx = makeCtx({ body: retiredQuota });
  const snapshot = await manifest.fetchUsage(ctx);
  const titles = (snapshot.extraWindows ?? []).map((window) => window.title);
  if (titles.includes("GLM 5.2")) throw new Error(`retired model kept: ${JSON.stringify(titles)}`);
  const rows = (snapshot.details ?? []).find((entry) => entry.title === "Modelos").rows.map((row) => row.label);
  if (rows.includes("GLM 5.2")) throw new Error(`retired model kept in details: ${JSON.stringify(rows)}`);
  if (!rows.includes("Oven 3.8 Flash")) throw new Error(`served model dropped: ${JSON.stringify(rows)}`);
});

const sampleCredits = {
  enabled: true,
  tier: "inference",
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-12-01T00:00:00.000Z",
  allowanceCredits: 7000,
  usedCredits: 1420.5,
  remainingCredits: 5579.5,
  packCredits: 1000,
  packExpiresAt: "2027-05-01T00:00:00.000Z",
  frontierPaused: false,
  frozen: false,
  models: [
    {
      model: "deepseek-v4-flash",
      displayName: "DeepSeek V4-Flash",
      approxCreditsPerMTokens: 1.5,
      creditsThisMonth: 820.3,
      tokensThisMonth: 550000000,
      rates: { inputPerM: 0.5, cachedInputPerM: 0.1, outputPerM: 2.0 },
    },
    {
      model: "glm5.3-flash",
      displayName: "GLM 5.3 Flash",
      approxCreditsPerMTokens: 1.0,
      creditsThisMonth: 600.2,
      tokensThisMonth: 600000000,
      rates: { inputPerM: 0.3, cachedInputPerM: 0.05, outputPerM: 1.2 },
    },
    {
      model: "glm5.2",
      displayName: "GLM 5.2",
      approxCreditsPerMTokens: 0.8,
      creditsThisMonth: 0,
      tokensThisMonth: 0,
    },
  ],
};

const manualCredits = { ...sampleCredits, usedCredits: 900, remainingCredits: 6100 };

const secondCredits = {
  ...sampleCredits,
  usedCredits: 3200,
  remainingCredits: 3800,
  packCredits: 0,
  packExpiresAt: undefined,
  models: [
    {
      model: "glm5.3-flash",
      displayName: "GLM 5.3 Flash",
      approxCreditsPerMTokens: 1.0,
      creditsThisMonth: 3200,
      tokensThisMonth: 3200000000,
      rates: { inputPerM: 0.3, cachedInputPerM: 0.05, outputPerM: 1.2 },
    },
  ],
};

check("credits response publishes primary bar with used credits percentage", async () => {
  const ctx = makeCtx({ credits: sampleCredits, cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  if (!snapshot.primary) throw new Error("primary window is missing in credits mode");
  if (snapshot.primary.title !== "Créditos") throw new Error(`title: ${snapshot.primary.title}`);
  const expectedPct = (1420.5 / 7000) * 100;
  if (Math.abs(snapshot.primary.usedPercent - expectedPct) > 0.01) {
    throw new Error(`usedPercent: ${snapshot.primary.usedPercent} !== ${expectedPct}`);
  }
  if (!snapshot.primary.resetDescription.includes("1,420.5 / 7,000")) {
    throw new Error(`resetDescription: ${snapshot.primary.resetDescription}`);
  }
  if (!snapshot.primary.resetsAt) throw new Error("resetsAt is missing");
});

check("credits detail rows carry allowance, pack credits and per-model consumption", async () => {
  const ctx = makeCtx({ credits: sampleCredits, cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  const creditSection = (snapshot.details ?? []).find((entry) => entry.title === "Créditos");
  if (!creditSection) throw new Error("missing Créditos section");
  const planRow = creditSection.rows.find((r) => r.label === "Plan mensual");
  if (!planRow || !planRow.value.includes("1,420.5 / 7,000")) throw new Error(`planRow: ${planRow?.value}`);
  const packRow = creditSection.rows.find((r) => r.label === "+ Pack créditos");
  if (!packRow || !packRow.value.includes("1,000 restantes") || !packRow.value.includes("caduca May 1 2027")) {
    throw new Error(`packRow: ${packRow?.value}`);
  }

  const modelSection = (snapshot.details ?? []).find((entry) => entry.title === "Modelos");
  if (!modelSection) throw new Error("missing Modelos section");
  const deepseek = modelSection.rows.find((r) => r.label === "DeepSeek V4-Flash");
  if (!deepseek || !deepseek.value.includes("820.3 cr") || !deepseek.value.includes("550M tokens")) {
    throw new Error(`deepseek row: ${deepseek?.value}`);
  }
  if (!deepseek.secondaryValue.includes("1.5 cr / 1M")) {
    throw new Error(`deepseek secondary: ${deepseek?.secondaryValue}`);
  }
});

check("credits endpoint gracefully handles pack-only accounts with no monthly allowance", async () => {
  const packOnlyCredits = {
    ...sampleCredits,
    tier: "packs",
    allowanceCredits: 0,
    usedCredits: 0,
    remainingCredits: 0,
    packCredits: 2500,
  };
  const ctx = makeCtx({ credits: packOnlyCredits, cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  if (!snapshot.primary) throw new Error("primary window missing");
  if (snapshot.primary.usedPercent !== 0) throw new Error(`usedPercent: ${snapshot.primary.usedPercent}`);
  if (!snapshot.primary.resetDescription.includes("2,500")) {
    throw new Error(`resetDesc: ${snapshot.primary.resetDescription}`);
  }
});

check("frozen credits account reflects paused status in details", async () => {
  const frozenCredits = { ...sampleCredits, frozen: true };
  const ctx = makeCtx({ credits: frozenCredits, cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  const statusRow = (snapshot.details ?? []).find((entry) => entry.title === "Créditos")?.rows.find((r) => r.label === "Estado");
  if (!statusRow || !statusRow.value.includes("Pausado")) {
    throw new Error(`statusRow: ${statusRow?.value}`);
  }
});

check("when credits returns enabled: false the plugin falls back to legacy quota", async () => {
  const disabledCredits = { enabled: false };
  const ctx = makeCtx({ credits: disabledCredits, cookieHeader: "session=abc" });
  const snapshot = await manifest.fetchUsage(ctx);
  if (snapshot.primary !== undefined) throw new Error("primary window published for legacy quota");
  const extras = (snapshot.extraWindows ?? []).map((w) => w.title);
  if (!extras.includes("DeepSeek V4-Flash")) throw new Error(`extras: ${JSON.stringify(extras)}`);
});

check("two browser sessions render as two tagged accounts", async () => {
  const ctx = makeCtx({
    sessions: [
      { id: "s1", header: "session=a", source: "chrome" },
      { id: "s2", header: "session=b", source: "safari" },
    ],
    onCreditsGet: (options) => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify(options.headers.Cookie === "session=a" ? sampleCredits : secondCredits),
    }),
  });
  const snapshot = await manifest.fetchUsage(ctx);
  const titles = (snapshot.details ?? []).map((section) => section.title);
  if (!titles.includes("Créditos · cuenta 1") || !titles.includes("Créditos · cuenta 2")) {
    throw new Error(`sections: ${JSON.stringify(titles)}`);
  }
  if (!titles.includes("Cuentas")) throw new Error(`no summary section: ${JSON.stringify(titles)}`);
  const ids = (snapshot.extraWindows ?? []).map((window) => window.id);
  if (!ids.includes("nan-credits-1") || !ids.includes("nan-credits-2")) throw new Error(`ids: ${JSON.stringify(ids)}`);
  if (!ids.includes("nan-1-deepseek-v4-flash") || !ids.includes("nan-2-glm5.3-flash")) {
    throw new Error(`ids: ${JSON.stringify(ids)}`);
  }
  const summary = (snapshot.details ?? []).find((section) => section.title === "Cuentas");
  if (summary.rows[0].value !== "Dashboard session (Chrome)") throw new Error(summary.rows[0].value);
  if (summary.rows[1].value !== "Dashboard session (Safari)") throw new Error(summary.rows[1].value);
  if (snapshot.identity.loginMethod !== "2 cuentas") throw new Error(snapshot.identity.loginMethod);
  if (snapshot.primary.title !== "Créditos · cuenta 1") throw new Error(snapshot.primary.title);
});

check("a manually pasted cookie is tried first and becomes cuenta 1", async () => {
  const ctx = makeCtx({
    manualCookie: "session=manual",
    onCreditsGet: (options) => ({
      status: 200,
      headers: {},
      bodyText: JSON.stringify(options.headers.Cookie === "session=manual" ? manualCredits : sampleCredits),
    }),
  });
  const snapshot = await manifest.fetchUsage(ctx);
  const firstCreditsCall = ctx.calls.find((call) => call.url.endsWith("/api/usage/credits"));
  if (firstCreditsCall.headers.Cookie !== "session=manual") throw new Error("manual cookie not tried first");
  if (snapshot.identity.loginMethod !== "2 cuentas") throw new Error(snapshot.identity.loginMethod);
  const summary = (snapshot.details ?? []).find((section) => section.title === "Cuentas");
  if (summary.rows[0].label !== "Cuenta 1") throw new Error(summary.rows[0].label);
  if (summary.rows[0].value !== "Cookie manual") throw new Error(summary.rows[0].value);
  if (snapshot.primary.title !== "Créditos · cuenta 1") throw new Error(snapshot.primary.title);
  const expected = (900 / 7000) * 100;
  if (Math.abs(snapshot.primary.usedPercent - expected) > 0.01) {
    throw new Error(`usedPercent: ${snapshot.primary.usedPercent} !== ${expected}`);
  }
});

check("an identical manual and browser cookie collapses into one account", async () => {
  const ctx = makeCtx({ manualCookie: "session=abc", credits: sampleCredits });
  const snapshot = await manifest.fetchUsage(ctx);
  const creditCalls = ctx.calls.filter((call) => call.url.endsWith("/api/usage/credits")).length;
  if (creditCalls !== 1) throw new Error(`credits calls: ${creditCalls}`);
  if (snapshot.identity.loginMethod !== "Cookie manual") throw new Error(snapshot.identity.loginMethod);
  if (snapshot.primary.title !== "Créditos") throw new Error(snapshot.primary.title);
  const titles = (snapshot.details ?? []).map((section) => section.title);
  if (titles.includes("Cuentas")) throw new Error(`single account got a summary section: ${JSON.stringify(titles)}`);
});

check("an expired first session is evicted while the second account still renders", async () => {
  const ctx = makeCtx({
    sessions: [
      { id: "s1", header: "session=dead", source: "chrome" },
      { id: "s2", header: "session=live", source: "safari" },
    ],
    onCreditsGet: (options) => ({
      status: options.headers.Cookie === "session=dead" ? 401 : 200,
      headers: {},
      bodyText: options.headers.Cookie === "session=dead" ? "" : JSON.stringify(sampleCredits),
    }),
    onQuotaGet: (options) => ({
      status: options.headers.Cookie === "session=dead" ? 401 : 200,
      headers: {},
      bodyText: JSON.stringify(quota),
    }),
  });
  const snapshot = await manifest.fetchUsage(ctx);
  if (!ctx.calls.some((call) => call.reject)) throw new Error("expired session was not evicted");
  if (!ctx.calls.some((call) => call.url.endsWith("/api/usage/credits") && call.headers.Cookie === "session=live")) {
    throw new Error("the second session was never tried");
  }
  if (snapshot.identity.loginMethod !== "Dashboard session (Safari)") throw new Error(snapshot.identity.loginMethod);
  if (snapshot.primary.title !== "Créditos") throw new Error(snapshot.primary.title);
});

check("a credits account and a legacy account render together", async () => {
  const ctx = makeCtx({
    sessions: [
      { id: "s1", header: "session=a", source: "chrome" },
      { id: "s2", header: "session=b", source: "safari" },
    ],
    onCreditsGet: (options) => ({
      status: options.headers.Cookie === "session=a" ? 200 : 404,
      headers: {},
      bodyText: options.headers.Cookie === "session=a" ? JSON.stringify(sampleCredits) : "",
    }),
  });
  const snapshot = await manifest.fetchUsage(ctx);
  if (!snapshot.primary) throw new Error("credits account lost its primary bar");
  const titles = (snapshot.details ?? []).map((section) => section.title);
  if (!titles.includes("Modelos · cuenta 2")) throw new Error(`sections: ${JSON.stringify(titles)}`);
  const summary = (snapshot.details ?? []).find((section) => section.title === "Cuentas");
  if (summary.rows[1].secondaryValue !== "Sin premium") throw new Error(summary.rows[1].secondaryValue);
  const ids = (snapshot.extraWindows ?? []).map((window) => window.id);
  if (!ids.includes("nan-credits-1") || !ids.includes("nan-2-Oven 3.8 Flash")) {
    throw new Error(`ids: ${JSON.stringify(ids)}`);
  }
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
