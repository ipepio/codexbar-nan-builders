# Changelog

All notable changes to this plugin are recorded here. The version applies to `nan-usage.ts`: replace the file, then
re-approve the plugin in CodexBar whenever the manifest changes.

## 0.0.2 — 2026-10-29

**Card layout**

- Removed the aggregate top bar. It repeated the first model row, which already carries the same percentage, so the
  card now starts with the model list.
- Each model row shows its own reset (`reinicia Nov 1`).
- Consequence: with no primary window, the menu-bar percentage has no automatic source. Pin a model in
  Settings → Plugins → Menu bar metric. Named windows remain in the snapshot for exactly that.

**Extra usage**

- Reads the dashboard's own fields: `extraTokens` (tokens left), `extraExpiresAt` (absolute expiry) and `extraUsable`.
- The pool is a sibling row directly under its model, with its own bar, instead of text appended to the model line:

  ```
  qwen3.8-flash   321.7M / 500M         reinicia Nov 1
  + extra         125M restantes · caduca Apr 29 2027
  ```

  A purchased pool does not expire with the billing cycle, so it cannot share that reset. The host's `monthDay` drops the
  year, so the pool's line appends it: a pool can outlive the current year. A paused pool has no bar and no expiry.
- The pool's bar is the share you still hold, so an untouched pool is full and a drained one empties. The API reports only
  what is left, so the largest value seen per expiry is remembered (`persistent-storage`) as the pool's size; a new expiry
  starts a new pool at full, and an unavailable store leaves the bar full rather than failing.
- Mirrors the dashboard's states: `pausado, requiere membresía activa` when `extraUsable` is false (no expiry shown),
  and `en uso` once the base cap is spent.

**Verification**

- Twenty offline checks, including a full pool, a drained pool against its remembered size, a new expiry, a paused pool,
  an in-use pool, an unavailable store and the harness gaining `format.monthDay`.

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
