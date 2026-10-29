// NaN Builders quota provider for CodexBar.
//
// Shows the per-model token quota of a NaN Builders subscription in the menu bar. Derived from
// CodexBar's bundled Helmcode plugin, pinned to the NaN tenant so it can run beside the built-in
// Helmcode provider (which shows Helmcode Cloud).
//
// Authentication is the NaN API key when one is configured, and the nan.builders dashboard cookies
// otherwise. Both hit the same origin: cloud-api.nan.builders.
const NAN_API = "https://cloud-api.nan.builders";
const NAN_INFERENCE_API = "https://api.nan.builders";
const NAN_DASHBOARD = "https://cloud.nan.builders";
const NAN_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M 458.3 134.1 Q 512.0 103.1 565.7 134.1 L 812.4 276.6 Q 866.1 307.6 866.1 369.6 L 866.1 654.5 Q 866.1 716.5 812.4 747.5 L 565.7 889.9 Q 512.0 920.9 458.3 889.9 L 211.6 747.5 Q 157.9 716.5 157.9 654.5 L 157.9 369.5 Q 157.9 307.5 211.6 276.5 Z" fill="none" stroke="#4934E1" stroke-width="46"/><path d="M 780.0 512.0 C 780.0 542.9 762.5 584.3 744.7 604.6 C 726.9 624.9 696.1 632.9 673.1 634.0 C 650.2 635.1 626.8 622.7 607.2 611.2 C 587.6 599.8 571.4 581.8 555.5 565.3 C 539.6 548.7 526.5 529.8 512.0 512.0 C 497.5 494.2 484.4 475.3 468.5 458.7 C 452.6 442.2 436.4 424.2 416.8 412.8 C 397.2 401.3 373.8 388.9 350.9 390.0 C 327.9 391.1 297.1 399.1 279.3 419.4 C 261.5 439.7 244.0 481.1 244.0 512.0 C 244.0 542.9 261.5 584.3 279.3 604.6 C 297.1 624.9 327.9 632.9 350.9 634.0 C 373.8 635.1 397.2 622.7 416.8 611.2 C 436.4 599.8 452.6 581.8 468.5 565.3 C 484.4 548.7 497.5 529.8 512.0 512.0 C 526.5 494.2 539.6 475.3 555.5 458.7 C 571.4 442.2 587.6 424.2 607.2 412.8 C 626.8 401.3 650.2 388.9 673.1 390.0 C 696.1 391.1 726.9 399.1 744.7 419.4 C 762.5 439.7 780.0 481.1 780.0 512.0 Z" fill="none" stroke="#4934E1" stroke-width="64"/></svg>`;

type Credential = {
  method: string;
  headers: Record<string, string>;
  onReject?: () => void;
};

type ModelRow = {
  name: string;
  cap: number;
  used: number;
  credit: number;
  hours: number | undefined;
  resetsAt: Date | undefined;
};

defineProvider({
  id: "nan-usage",
  name: "NaN Builders",
  icon: { monogram: "NaN", tint: "#4934E1", svg: NAN_MARK },
  endpoints: [NAN_API, NAN_INFERENCE_API],
  settings: [
    {
      key: "API_KEY",
      title: "API key",
      subtitle: "cloud.nan.builders, user settings, API Keys. Without a key the plugin reads browser cookies.",
      type: "secure",
    },
  ],
  capabilities: ["browser-cookies", "http-status"],
  cookieDomains: ["nan.builders"],
  async fetchUsage(ctx) {
    const fail = (field: string): never => {
      throw ctx.fail.parseFailure(`NaN Builders quota response format changed: ${field}`);
    };
    const object = (value: unknown): Record<string, unknown> | undefined =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    const parse = (body: string): Record<string, unknown> => {
      try {
        return object(JSON.parse(body)) ?? fail("expected object");
      } catch (error) {
        void error;
        return fail("invalid JSON");
      }
    };
    // Quota rows carry display names ("GLM 5.3 Flash") while /v1/models carries ids
    // ("glm5.3-flash"), so both sides are compared with punctuation and case removed.
    const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchesServed = (name: string, served: Set<string>): boolean => {
      const candidate = normalize(name);
      if (candidate.length === 0) return true;
      for (const id of served) {
        if (id === candidate || id.endsWith(candidate) || candidate.endsWith(id)) return true;
        if (id.length >= 5 && candidate.length >= 5 && (candidate.includes(id) || id.includes(candidate))) return true;
      }
      return false;
    };
    const integer = (value: unknown, field: string): number => {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(field);
      return value;
    };

    // One credential list, tried in order: the API key first, then dashboard cookie scopes.
    const key = (ctx.settings.getSecret("API_KEY") ?? "").trim();
    const credentials: Credential[] = [];
    if (key) credentials.push({ method: "API key", headers: { Authorization: `Bearer ${key}` } });
    if (ctx.browser.availability("nan.builders") !== "off") {
      try {
        for await (const session of ctx.browser.sessions("nan.builders")) {
          if (!session.header) continue;
          credentials.push({
            method: "Dashboard session",
            headers: { Cookie: session.header },
            onReject: () => ctx.browser.rejectCookie("nan.builders", session),
          });
        }
      } catch (error) {
        void error;
      }
    }

    let rejected = false;
    for (const credential of credentials) {
      const headers = {
        ...credential.headers,
        Origin: NAN_DASHBOARD,
        Referer: `${NAN_DASHBOARD}/dashboard`,
      };
      const get = (path: string, timeoutSeconds = 8) =>
        ctx.http.get(`${NAN_API}${path}`, { headers, timeoutSeconds });
      const response = await get("/api/usage/quota");
      if ((response.status >= 300 && response.status < 400) || response.status === 401 || response.status === 403) {
        credential.onReject?.();
        rejected = true;
        continue;
      }
      const seconds = Number(response.headers["retry-after"] ?? 1);
      const retryAfterSeconds = Number.isFinite(seconds) && seconds >= 0 ? Math.min(10, seconds) : 1;
      if (response.status === 429) throw ctx.fail.rateLimited("NaN Builders rate limit reached.", { retryAfterSeconds });
      if (response.status === 408 || response.status >= 500)
        throw ctx.fail.providerUnavailable("NaN Builders is unavailable.", { retryAfterSeconds });
      if (response.status < 200 || response.status >= 300)
        throw ctx.fail.apiFailure(`NaN Builders returned HTTP ${response.status}.`);

      const quota = parse(response.bodyText);
      if (typeof quota.periodStart !== "string" || !Array.isArray(quota.models)) return fail("periodStart or models");
      const optional = async (path: string): Promise<Record<string, unknown> | undefined> => {
        try {
          const result = await get(path, 2);
          return result.status === 200 ? parse(result.bodyText) : undefined;
        } catch (error) {
          void error;
          return undefined;
        }
      };
      const billing = await optional("/api/billing");
      // A missing or unreadable billing response must not turn a paid tier into an available one.
      const premium = object(billing?.subscription)?.premium === true;
      const start = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(quota.periodStart);
      const fallback =
        start && Number(start[2]) >= 1 && Number(start[2]) <= 12 && Number(start[3]) >= 1 && Number(start[3]) <= 31
          ? new Date(Date.UTC(Number(start[1]), Number(start[2]), 1))
          : undefined;
      // A retired model can outlive its dashboard listing inside the quota payload. /v1/models is
      // the authoritative list of what the cluster serves today, but it needs the API key: a cookie
      // session cannot ask, so it keeps the payload exactly as reported.
      const servedModels = async (): Promise<Set<string> | undefined> => {
        try {
          const result = await ctx.http.get(`${NAN_INFERENCE_API}/v1/models`, {
            headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
            timeoutSeconds: 4,
          });
          if (result.status !== 200) return undefined;
          const body = object(JSON.parse(result.bodyText));
          const data = body?.data;
          if (!Array.isArray(data)) return undefined;
          const ids = data
            .map((entry: unknown) => object(entry)?.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
            .map(normalize);
          return ids.length > 0 ? new Set(ids) : undefined;
        } catch (error) {
          void error;
          return undefined;
        }
      };
      const models: ModelRow[] = quota.models.map((value: unknown) => {
        const row = object(value) ?? fail("model");
        if (typeof row.model !== "string" || !ctx.isDetailLabel(row.model)) return fail("model name");
        const cap = integer(row.cap, "cap");
        const used = integer(row.tokensUsed, "tokensUsed");
        const credit = row.creditTokens == null ? 0 : integer(row.creditTokens, "creditTokens");
        const hours = row.windowHours == null ? undefined : integer(row.windowHours, "windowHours");
        if (hours !== undefined && (hours < 1 || hours > 525600 / 60)) return fail("windowHours");
        let resetsAt = fallback;
        if (typeof row.periodEnd === "string") {
          try {
            resetsAt = ctx.date.iso(row.periodEnd) ?? fallback;
          } catch (error) {
            void error;
          }
        }
        return { name: row.model, cap, used, credit, hours, resetsAt };
      });

      const served = credential.method === "API key" ? await servedModels() : undefined;
      const filtered = served === undefined ? models : models.filter((row) => matchesServed(row.name, served));
      // Fail open: an empty result means the two naming schemes disagreed, not that nothing is left.
      const visible = filtered.length > 0 ? filtered : models;

      // A rolling tier is a paid add-on the account may not hold, and a zero cap is no allowance at
      // all: neither is a measured percentage, so both are reported instead of drawn.
      const usable = (row: ModelRow): boolean => row.cap > 0 && (row.hours === undefined || premium);
      const locked = (row: ModelRow): string =>
        row.hours !== undefined && !premium ? "Requiere suscripción Plus" : "No incluido en tu plan";

      const percent = (row: ModelRow): number => ctx.pct(row.used, row.cap);
      const byUsage = (a: ModelRow, b: ModelRow): number =>
        percent(b) - percent(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const windows = visible
        .filter(usable)
        .sort(byUsage)
        .map((row) => ({
          id: `nan-${row.name}`,
          title: row.name,
          window: {
            usedPercent: percent(row),
            resetsAt: row.resetsAt,
            windowMinutes: row.hours === undefined ? undefined : row.hours * 60,
            resetDescription:
              `${row.name} · ${ctx.format.number(row.used)} / ${ctx.format.number(row.cap)} tokens` +
              (row.credit > 0 ? ` · ${ctx.format.number(row.credit)} credit-funded` : ""),
            title: row.name,
          },
        }));

      const tokens = (value: number): string =>
        value >= 1e9
          ? `${(value / 1e9).toFixed(1).replace(/\.0$/, "")}B`
          : value >= 1e6
            ? `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`
            : value >= 1e3
              ? `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`
              : String(value);

      // CodexBar renders named extra windows in the popover only for Antigravity, so the per-model
      // breakdown travels as detail rows, which every provider card renders. extraWindows stay in
      // the snapshot for the menu-bar metric picker, widgets and quota warnings.
      const breakdown = [...visible].sort((a, b) => {
        const aUsable = usable(a) ? 1 : 0;
        const bUsable = usable(b) ? 1 : 0;
        return aUsable !== bUsable ? bUsable - aUsable : byUsage(a, b);
      });
      const sections: Record<string, unknown>[] = [];
      if (breakdown.length > 0) {
        sections.push({
          title: "Modelos",
          rows: breakdown.map((row) => ({
            label: row.name,
            value: usable(row) ? `${tokens(row.used)} / ${tokens(row.cap)}` : locked(row),
            progress: usable(row) ? Math.min(1, row.used / row.cap) : null,
            usageValue: usable(row) ? row.used : null,
          })),
        });
      }
      if (billing !== undefined) {
        sections.push({
          title: "Cuenta",
          rows: [
            { label: "Autenticación", value: credential.method },
            { label: "Suscripción premium", value: premium ? "Activa" : "No activa" },
          ],
        });
      }

      return {
        primary: windows[0]?.window,
        extraWindows: windows.slice(1),
        details: sections,
        identity: { organization: "NaN Builders", loginMethod: credential.method },
        dataConfidence: "exact",
      };
    }

    if (rejected && key && credentials.length === 1) {
      throw ctx.fail.authenticationExpired(
        "NaN Builders rejected the API key. Create a new one at cloud.nan.builders, user settings, API Keys.",
      );
    }
    if (rejected) throw ctx.fail.authenticationExpired("NaN Builders rejected the stored session. Sign in again.");
    throw ctx.fail.missingCredential(
      "Add a NaN API key in the plugin settings (cloud.nan.builders, user settings, API Keys), " +
        `or sign in to cloud.nan.builders. Supported browsers: ${ctx.browser.supportedBrowsers}.`,
    );
  },
});
