// NaN Builders quota and credit provider for CodexBar.
//
// Shows credit allowance and per-model consumption of a NaN Builders subscription in the menu bar.
// Authentication uses the nan.builders dashboard cookies against cloud-api.nan.builders.
const NAN_API = "https://cloud-api.nan.builders";
const NAN_DASHBOARD = "https://cloud.nan.builders";
const NAN_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="M 458.3 134.1 Q 512.0 103.1 565.7 134.1 L 812.4 276.6 Q 866.1 307.6 866.1 369.6 L 866.1 654.5 Q 866.1 716.5 812.4 747.5 L 565.7 889.9 Q 512.0 920.9 458.3 889.9 L 211.6 747.5 Q 157.9 716.5 157.9 654.5 L 157.9 369.5 Q 157.9 307.5 211.6 276.5 Z" fill="none" stroke="#4934E1" stroke-width="46"/><path d="M 780.0 512.0 C 780.0 542.9 762.5 584.3 744.7 604.6 C 726.9 624.9 696.1 632.9 673.1 634.0 C 650.2 635.1 626.8 622.7 607.2 611.2 C 587.6 599.8 571.4 581.8 555.5 565.3 C 539.6 548.7 526.5 529.8 512.0 512.0 C 497.5 494.2 484.4 475.3 468.5 458.7 C 452.6 442.2 436.4 424.2 416.8 412.8 C 397.2 401.3 373.8 388.9 350.9 390.0 C 327.9 391.1 297.1 399.1 279.3 419.4 C 261.5 439.7 244.0 481.1 244.0 512.0 C 244.0 542.9 261.5 584.3 279.3 604.6 C 297.1 624.9 327.9 632.9 350.9 634.0 C 373.8 635.1 397.2 622.7 416.8 611.2 C 436.4 599.8 452.6 581.8 468.5 565.3 C 484.4 548.7 497.5 529.8 512.0 512.0 C 526.5 494.2 539.6 475.3 555.5 458.7 C 571.4 442.2 587.6 424.2 607.2 412.8 C 626.8 401.3 650.2 388.9 673.1 390.0 C 696.1 391.1 726.9 399.1 744.7 419.4 C 762.5 439.7 780.0 481.1 780.0 512.0 Z" fill="none" stroke="#4934E1" stroke-width="64"/></svg>`;

type Credential = {
  method: string;
  headers: Record<string, string>;
  onReject?: () => void;
};

type CreditRates = {
  input: number;
  cachedInput: number;
  output: number;
  cacheWrite?: number;
};

type CreditModelRow = {
  model: string;
  displayName: string;
  approxCreditsPerMTokens: number;
  creditsThisMonth: number;
  tokensThisMonth: number;
  description: string;
  rates?: CreditRates;
};

type CreditsData = {
  enabled: boolean;
  tier: string;
  periodStart: Date | undefined;
  periodEnd: Date | undefined;
  allowanceCredits: number;
  usedCredits: number;
  remainingCredits: number;
  packCredits: number;
  packExpiresAt: Date | undefined;
  frontierPaused: boolean;
  frozen: boolean;
  models: CreditModelRow[];
};

type ModelRow = {
  name: string;
  cap: number;
  used: number;
  /** Remaining tokens of the purchased extra-usage pool, which expires on its own date. */
  extra: number;
  extraUsable: boolean;
  extraExpiresAt: Date | undefined;
  hours: number | undefined;
  resetsAt: Date | undefined;
};

defineProvider({
  id: "nan-usage",
  name: "NaN Builders",
  icon: { monogram: "NaN", tint: "#4934E1", svg: NAN_MARK },
  endpoints: [NAN_API],
  settings: [],
  capabilities: ["browser-cookies", "http-status", "persistent-storage"],
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

    const tokens = (value: number): string =>
      value >= 1e9
        ? `${(value / 1e9).toFixed(1).replace(/\.0$/, "")}B`
        : value >= 1e6
          ? `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`
          : value >= 1e3
            ? `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`
            : String(value);

    const day = (value: Date | undefined, withYear = false): string | undefined => {
      if (value === undefined) return undefined;
      try {
        const monthDay = ctx.format.monthDay(value);
        return withYear ? `${monthDay} ${value.getFullYear()}` : monthDay;
      } catch (error) {
        void error;
        return undefined;
      }
    };

    const formatCredits = (value: number): string => {
      if (!Number.isFinite(value) || value <= 0) return "0";
      const floored = Math.floor(value * 10) / 10;
      return floored % 1 === 0
        ? floored.toLocaleString("en-US")
        : floored.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    };

    const parseCredits = (body: Record<string, unknown>): CreditsData | undefined => {
      if (body.enabled !== true) return undefined;
      const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || !v) return undefined;
        try {
          const d = ctx.date.iso(v);
          return d && !Number.isNaN(d.getTime()) ? d : undefined;
        } catch {
          return undefined;
        }
      };

      const allowance = num(body.allowanceCredits);
      const used = num(body.usedCredits);
      const remaining =
        typeof body.remainingCredits === "number" && Number.isFinite(body.remainingCredits)
          ? Math.max(0, body.remainingCredits)
          : Math.max(0, allowance - used);

      const rawModels = Array.isArray(body.models) ? body.models : [];
      const models: CreditModelRow[] = [];
      for (const item of rawModels) {
        const m = object(item);
        if (!m || typeof m.model !== "string" || !m.model) continue;
        let rates: CreditRates | undefined;
        const r = object(m.rates);
        if (r) {
          const inp = num(r.inputPerM ?? r.input);
          const cinp = num(r.cachedInputPerM ?? r.cachedInput);
          const outp = num(r.outputPerM ?? r.output);
          const cwrite =
            r.cacheWritePerM != null || r.cacheWrite != null
              ? num(r.cacheWritePerM ?? r.cacheWrite)
              : undefined;
          rates = { input: inp, cachedInput: cinp, output: outp, cacheWrite: cwrite };
        }
        models.push({
          model: m.model,
          displayName: typeof m.displayName === "string" && m.displayName ? m.displayName : m.model,
          approxCreditsPerMTokens: num(m.approxCreditsPerMTokens),
          creditsThisMonth: num(m.creditsThisMonth),
          tokensThisMonth: num(m.tokensThisMonth),
          description: typeof m.description === "string" ? m.description : "",
          rates,
        });
      }

      return {
        enabled: true,
        tier: typeof body.tier === "string" ? body.tier : "inference",
        periodStart: parseDate(body.periodStart),
        periodEnd: parseDate(body.periodEnd),
        allowanceCredits: allowance,
        usedCredits: used,
        remainingCredits: remaining,
        packCredits: num(body.packCredits),
        packExpiresAt: parseDate(body.packExpiresAt),
        frontierPaused: body.frontierPaused === true,
        frozen: body.frozen === true,
        models,
      };
    };

    const buildCreditsSnapshot = (
      credits: CreditsData,
      credential: Credential,
    ) => {
      const allowance = credits.allowanceCredits;
      const used = credits.usedCredits;
      const remaining = credits.remainingCredits;
      const percentUsed = allowance > 0 ? ctx.pct(used, allowance) : credits.packCredits > 0 ? 0 : 100;

      const reset = day(credits.periodEnd);
      const resetDesc = allowance > 0
        ? `${formatCredits(used)} / ${formatCredits(allowance)} créditos · ${formatCredits(remaining)} restantes`
        : `${formatCredits(credits.packCredits)} créditos de pack restantes`;

      const primary = {
        usedPercent: percentUsed,
        resetsAt: credits.periodEnd,
        resetDescription: reset ? `${resetDesc} (reinicia ${reset})` : resetDesc,
        title: "Créditos",
      };

      const retired = new Set(["glm5.2"].map(normalize));
      const filteredModels = credits.models.filter(
        (m) => !retired.has(normalize(m.model)) && !retired.has(normalize(m.displayName)),
      );

      const candidates = filteredModels.length > 0 ? filteredModels : credits.models;
      const sortedModels = [...candidates].sort((a, b) => {
        const usageA = a.creditsThisMonth > 0 || a.tokensThisMonth > 0 ? 1 : 0;
        const usageB = b.creditsThisMonth > 0 || b.tokensThisMonth > 0 ? 1 : 0;
        if (usageA !== usageB) return usageB - usageA;
        return (
          b.creditsThisMonth - a.creditsThisMonth ||
          b.tokensThisMonth - a.tokensThisMonth ||
          a.displayName.localeCompare(b.displayName)
        );
      });

      const extraWindows = [
        {
          id: "nan-credits",
          title: "Créditos",
          window: primary,
        },
        ...sortedModels.map((m) => ({
          id: `nan-${m.model}`,
          title: m.displayName,
          window: {
            usedPercent: allowance > 0 ? ctx.pct(m.creditsThisMonth, allowance) : 0,
            resetsAt: credits.periodEnd,
            resetDescription: `${m.displayName} · ${formatCredits(m.creditsThisMonth)} créditos (${tokens(m.tokensThisMonth)} tokens)`,
            title: m.displayName,
          },
        })),
      ];

      const sections: Record<string, unknown>[] = [];

      const creditRows: Record<string, unknown>[] = [];
      if (allowance > 0) {
        creditRows.push({
          label: "Plan mensual",
          value: `${formatCredits(used)} / ${formatCredits(allowance)} créditos`,
          secondaryValue: reset ? `reinicia ${reset}` : null,
          progress: Math.min(1, used / allowance),
          usageValue: used,
        });
      }
      if (credits.packCredits > 0) {
        const packParts: string[] = [`${formatCredits(credits.packCredits)} restantes`];
        if (allowance > 0 && remaining <= 0) packParts.push("en uso");
        const packExpiry = day(credits.packExpiresAt, true);
        if (packExpiry) packParts.push(`caduca ${packExpiry}`);
        creditRows.push({
          label: "+ Pack créditos",
          value: packParts.join(" · "),
          secondaryValue: null,
          progress: null,
          usageValue: null,
        });
      }
      if (credits.frozen) {
        creditRows.push({
          label: "Estado",
          value: "Pausado (requiere suscripción activa)",
          secondaryValue: null,
          progress: null,
          usageValue: null,
        });
      } else if (credits.frontierPaused) {
        creditRows.push({
          label: "Modelos Frontier",
          value: "Requieren créditos de pack",
          secondaryValue: null,
          progress: null,
          usageValue: null,
        });
      }

      if (creditRows.length > 0) {
        sections.push({
          title: "Créditos",
          rows: creditRows,
        });
      }

      if (sortedModels.length > 0) {
        sections.push({
          title: "Modelos",
          rows: sortedModels.map((row) => {
            const hasUsage = row.creditsThisMonth > 0 || row.tokensThisMonth > 0;
            const rateDesc =
              row.approxCreditsPerMTokens > 0 ? `≈ ${row.approxCreditsPerMTokens.toFixed(1)} cr / 1M` : null;
            return {
              label: row.displayName,
              value: hasUsage
                ? `${formatCredits(row.creditsThisMonth)} cr (${tokens(row.tokensThisMonth)} tokens)`
                : rateDesc ?? "Sin uso",
              secondaryValue: hasUsage ? rateDesc : null,
              progress:
                allowance > 0 && row.creditsThisMonth > 0
                  ? Math.min(1, row.creditsThisMonth / allowance)
                  : null,
              usageValue: row.creditsThisMonth > 0 ? row.creditsThisMonth : null,
            };
          }),
        });
      }

      const tierLabel =
        credits.tier === "premium" ? "Premium" : credits.tier === "packs" ? "Pack de créditos" : "Inference";
      sections.push({
        title: "Cuenta",
        rows: [
          { label: "Autenticación", value: credential.method },
          { label: "Plan", value: tierLabel },
        ],
      });

      return {
        primary,
        extraWindows,
        details: sections,
        identity: { organization: "NaN Builders", loginMethod: credential.method },
        dataConfidence: "exact",
      };
    };

    const credentials: Credential[] = [];
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

    // Try credits endpoint first
    for (const credential of credentials) {
      const headers = {
        ...credential.headers,
        Origin: NAN_DASHBOARD,
        Referer: `${NAN_DASHBOARD}/dashboard`,
      };
      const get = (path: string, timeoutSeconds = 8) =>
        ctx.http.get(`${NAN_API}${path}`, { headers, timeoutSeconds });

      let response;
      try {
        response = await get("/api/usage/credits");
      } catch (error) {
        void error;
        continue;
      }

      const seconds = Number(response.headers["retry-after"] ?? 1);
      const retryAfterSeconds = Number.isFinite(seconds) && seconds >= 0 ? Math.min(10, seconds) : 1;
      if (response.status === 429) {
        throw ctx.fail.rateLimited("NaN Builders rate limit reached.", { retryAfterSeconds });
      }
      if (response.status === 408 || response.status >= 500) {
        throw ctx.fail.providerUnavailable("NaN Builders is unavailable.", { retryAfterSeconds });
      }
      if (response.status === 404) {
        break;
      }

      if (response.status === 200) {
        try {
          const body = parse(response.bodyText);
          const credits = parseCredits(body);
          if (credits && credits.enabled) {
            return buildCreditsSnapshot(credits, credential);
          }
        } catch (error) {
          void error;
        }
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
      const models: ModelRow[] = quota.models.map((value: unknown) => {
        const row = object(value) ?? fail("model");
        if (typeof row.model !== "string" || !ctx.isDetailLabel(row.model)) return fail("model name");
        const cap = integer(row.cap, "cap");
        const used = integer(row.tokensUsed, "tokensUsed");
        const extra = row.extraTokens == null ? 0 : integer(row.extraTokens, "extraTokens");
        const extraUsable = row.extraUsable !== false;
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
        let extraExpiresAt: Date | undefined;
        if (typeof row.extraExpiresAt === "string") {
          try {
            extraExpiresAt = ctx.date.iso(row.extraExpiresAt);
          } catch (error) {
            void error;
          }
        }
        return { name: row.model, cap, used, extra, extraUsable, extraExpiresAt, hours, resetsAt };
      });

      const retired = new Set(["glm5.2"].map(normalize));
      const filtered = models.filter((row) => !retired.has(normalize(row.name)));
      // Fail open: an empty result means the filter disagreed, not that nothing is left.
      const visible = filtered.length > 0 ? filtered : models;

      // A rolling tier is a paid add-on the account may not hold, and a zero cap is no allowance at
      // all: neither is a measured percentage, so both are reported instead of drawn.
      const usable = (row: ModelRow): boolean => row.cap > 0 && (row.hours === undefined || premium);
      const locked = (row: ModelRow): string =>
        row.hours !== undefined && !premium ? "Requiere suscripción Plus" : "No incluido en tu plan";

      const percent = (row: ModelRow): number => ctx.pct(row.used, row.cap);
      const byUsage = (a: ModelRow, b: ModelRow): number =>
        percent(b) - percent(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

      // Named windows stay in the snapshot so Settings → Plugins → Menu bar metric can pin one
      // model. They are not drawn in the card, which lists every model instead.
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
            resetDescription: `${row.name} · ${ctx.format.number(row.used)} / ${ctx.format.number(row.cap)} tokens`,
            title: row.name,
          },
        }));

      const breakdown = [...visible].sort((a, b) => {
        const aUsable = usable(a) ? 1 : 0;
        const bUsable = usable(b) ? 1 : 0;
        return aUsable !== bUsable ? bUsable - aUsable : byUsage(a, b);
      });

      // The base window resets on a billing cycle; a purchased extra-usage pool expires on its own
      // absolute date, so both belong on the model's row rather than in one shared summary.
      const resetLine = (row: ModelRow): string | undefined => {
        const reset = day(row.resetsAt);
        return reset === undefined ? undefined : `reinicia ${reset}`;
      };

      // The payload only reports how much of a purchased pool is left, never how large it was, so the
      // largest value seen for a given expiry is remembered and becomes the pool's size. That makes an
      // untouched pool read full and a drained one read empty, and a new expiry starts a new pool.
      const poolSize = (row: ModelRow): number => {
        if (row.extra <= 0) return row.extra;
        const key = `nan-extra:${row.name}:${row.extraExpiresAt?.toISOString() ?? "none"}`;
        try {
          const stored = Number(ctx.storage.get(key) ?? 0);
          const size = Number.isFinite(stored) && stored > row.extra ? stored : row.extra;
          if (size !== stored) ctx.storage.set(key, String(size));
          return size;
        } catch (error) {
          void error;
          return row.extra;
        }
      };

      // The dashboard draws the extra pool as its own bar under the base one, and CodexBar gives a
      // row a single bar, so the pool becomes a sibling row holding the remaining share of the pool.
      const extraRow = (row: ModelRow): Record<string, unknown> | undefined => {
        if (row.extra <= 0) return undefined;
        const parts: string[] = [];
        if (!row.extraUsable) {
          parts.push("pausado, requiere membresía activa");
        } else {
          parts.push(`${tokens(row.extra)} restantes`);
          if (row.cap > 0 && row.used >= row.cap) parts.push("en uso");
        }
        const expiry = row.extraUsable ? day(row.extraExpiresAt, true) : undefined;
        if (expiry !== undefined) parts.push(`caduca ${expiry}`);
        return {
          label: "+ extra",
          value: parts.join(" · "),
          secondaryValue: null,
          progress: row.extraUsable && poolSize(row) > 0 ? Math.min(1, row.extra / poolSize(row)) : null,
          usageValue: null,
        };
      };

      const sections: Record<string, unknown>[] = [];
      if (breakdown.length > 0) {
        sections.push({
          title: "Modelos",
          rows: breakdown.flatMap((row) => {
            const base = {
              label: row.name,
              value: usable(row) ? `${tokens(row.used)} / ${tokens(row.cap)}` : locked(row),
              secondaryValue: resetLine(row) ?? null,
              progress: usable(row) ? Math.min(1, row.used / row.cap) : null,
              usageValue: usable(row) ? row.used : null,
            };
            const extra = extraRow(row);
            return extra === undefined ? [base] : [base, extra];
          }),
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

      // No primary, secondary or tertiary on purpose: the card's top bar repeated the first model
      // row, and each model row below already carries its own percentage, reset and extra usage.
      // The menu-bar percentage therefore needs a model pinned in Settings → Plugins.
      return {
        extraWindows: windows,
        details: sections,
        identity: { organization: "NaN Builders", loginMethod: credential.method },
        dataConfidence: "exact",
      };
    }

    if (rejected) throw ctx.fail.authenticationExpired("NaN Builders rejected the stored session. Sign in again.");
    throw ctx.fail.missingCredential(
      "Sign in to cloud.nan.builders in a supported browser. " +
        `Supported browsers: ${ctx.browser.supportedBrowsers}. If you use Safari, enable Full Disk Access for CodexBar in System Settings > Privacy & Security.`,
    );
  },
});
