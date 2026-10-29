# Changelog

All notable changes to this plugin are recorded here. The version applies to `nan-usage.ts`: replace the file, then
re-approve the plugin in CodexBar whenever the manifest changes.

## 0.0.1 — 2026-10-29

First tagged release.

**Shows**

- One menu-bar bar per usable NaN Builders model, ordered by how full it is, with the reset countdown.
- A per-model breakdown in the popover card: tokens used against the cap, with `progress` and `usageValue` so the app can
  draw each row.
- The account section: which credential answered, and whether the premium subscription is active.

**Authentication**

- NaN API key as the primary credential (`Authorization: Bearer`), which never reads a browser cookie.
- Dashboard cookies on `nan.builders` as the fallback when no key is configured.
- A rejected key fails loudly instead of silently falling back to a stale cookie.

**Correctness**

- Premium rolling tiers the account does not hold are labelled `Requiere suscripción Plus`; a zero cap is
  `No incluido en tu plan`. Neither is drawn as a measured percentage.
- Retired models are dropped by cross-checking `/api/usage/quota` against `api.nan.builders/v1/models`, which needs the
  API key. The check fails open on a non-200 answer, an unreadable body, or a naming disagreement. No retirement list is
  hardcoded, and a cookie session keeps the payload as reported.

**Presentation**

- The NaN isotipo as an inline monochrome SVG within CodexBar's icon rules, tinted `#4934E1`, the brand colour CodexBar
  gives Helmcode.

**Verification**

- Fourteen offline checks (`node --experimental-strip-types tests/snapshot.test.mjs`) covering the manifest, the icon,
  both credential paths, the missing-credential message, window ordering, detail rows, premium labelling, the paid-tier
  window, rejection handling, and all three fail-open paths of the served-model filter.

**Install**

```bash
mkdir -p ~/.config/codexbar/providers
curl -fsSL https://raw.githubusercontent.com/ipepio/codexbar-nan-builders/v0.0.1/nan-usage.ts \
  -o ~/.config/codexbar/providers/nan-usage.ts
```
