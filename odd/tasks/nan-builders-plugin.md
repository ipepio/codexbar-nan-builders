# NaN Builders provider for CodexBar

Header: A local CodexBar user plugin that shows NaN Builders subscription quotas in the menu bar, authenticated with a NaN API key or dashboard cookies.

Owner request: `ipepio`. Repo: `github.com/ipepio/codexbar-nan-builders`.

## Specs

S1. The plugin must live as a single self-contained TypeScript file that CodexBar can load from `~/.config/codexbar/providers/`, with no imports, no build step, and no network origin outside `https://cloud-api.nan.builders`.

S2. Authentication must prefer the NaN API key: when an API key is configured, every request carries `Authorization: Bearer <key>` and no browser cookie is read. The user's exact words: "podemos hacer que detecte la key?".

S3. When no API key is configured, the plugin must fall back to the `nan.builders` dashboard cookies already supported by the bundled Helmcode plugin, and the resulting error must name both options.

S4. The plugin must not invent availability. Models the account cannot use are reported as such, never as a measured percentage:
- a model that the billing endpoint reports as a premium tier the account lacks is labelled as requiring the premium subscription (GLM 5.3 is "por suscripción plus, y yo no la tengo");
- a model with no positive cap and no rolling tier is labelled as not included, never dropped silently;
- models the API no longer returns (GLM 5.2, "ya no está dispo") are simply absent, because the API is the source of truth and the plugin hardcodes no retirement list.

S5. The popover card must show one bar per usable model. Because CodexBar renders named `extraWindows` in the card only for Antigravity, the per-model breakdown must travel as a `details` section whose rows carry `progress` and `usageValue`; `extraWindows` stays in the snapshot for the menu-bar metric picker, widgets and quota warnings.

S6. The plugin icon must use the NaN isotipo supplied at `~/Downloads/nan-isotipo-color.png`, expressed as an inline monochrome SVG that satisfies CodexBar's icon rules (no raster, no styles, no `url()`, only `svg`/`path`/`g`/`circle`/`rect`/`polygon` with plain geometry, fill and stroke attributes).

S7. The repository must document installation, authentication, every setting, the API contract it depends on, and troubleshooting, so a new user can go from clone to visible quota without reading the source.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S3 | inline | `feat: bearer API key auth with cookie fallback` |
| T2 | S4, S5 | inline | `feat: label premium and unavailable models, keep per-model detail rows` |
| T3 | S6 | inline | `feat: use the NaN isotipo as the plugin icon` |
| T4 | S7 | inline | `docs: installation, authentication and API contract` |
| T5 | — | inline | `test: offline snapshot harness` + publish |

## Log

L1. Verbatim original request: "otro cambio más, glm5.2 ya no está dispo, y 5.3 es por suscripción plus, y yo no la tengo. podemos hacer que detecte la key? además de añadir esta imagen como logo /Users/iasacpepio/Downloads/nan-isotipo-color.png Después estaría guay meter este pluggin en un repo de github, documentar como isntalarlo y documentarlo también btw"

L2. Clarification answers: "Las dos cosas, pero como te autenticas ahora?" (both API-key authentication and plan detection) and "Crear y publicar público en ipepio".

L3. Evidence for API-key authentication: the community Noctalia plugin `cmoro-deusto/nan-usage` documents three GETs to `https://cloud-api.nan.builders` with the key as a bearer token — `/api/usage/quota`, `/api/auth/me`, `/api/metrics/usage`. Independent confirmation that the same origin the cookie path uses also accepts an API key.

L4. Evidence for S5: CodexBar 0.82.0 maps `extraWindows` correctly (`ProviderPluginSnapshotMapper.swift`) but `MenuCardView+ModelHelpers.swift::extraRateWindowMetrics` is only called from `antigravityMetrics`, so named extras never render in the popover for plugins.

L5. Evidence for S4: `nan.builders/docs/models` currently lists only `glm5.3` and `glm5.3-flash`; GLM 5.3 is described as premium-tier, callable only with a key on the GLM 5.3 premium membership, 3,000M tokens per member plus a 400M per rolling 4-hour window.
