# Copilot Instructions

This is a static Manifest V3 browser extension for Sendmaster, a popup that checks SPF, DKIM, DMARC, and nameserver DNS records for the active tab's domain.

## Key Files

- `chrome-extension/` and `edge-extension/` are mirrored extension packages. Keep `manifest.json`, `popup.html`, `popup.css`, `popup.js`, and `icons/` behaviorally identical unless a browser-specific change is intentional.
- `chrome-extension/manifest.json` and `edge-extension/manifest.json` define the toolbar action route: `action.default_popup` loads `popup.html`. Permissions are limited to `activeTab`, `storage`, and host access for Cloudflare/Google DNS-over-HTTPS.
- `popup.html` is the production popup DOM. Its IDs are used directly by `popup.js`; update selectors and script references together.
- `popup.js` owns all production behavior: active-tab hostname lookup, root/current domain mode, DNS-over-HTTPS queries, local cache, selector management, validation, rendering, refresh, and copy summary.
- `popup.css` is the production theme and layout for the constrained 410px popup.
- `mockup.html`, `mockup.js`, and `styles.css` are root-level prototype/demo files for visual preview only. Do not treat them as the runtime extension unless the user asks to sync prototype changes into the extension folders.
- `privacy-policy.html` documents current data handling and must stay aligned with storage keys, network destinations, and permissions.

## Wiring And Routes

- There is no app router, bundler, framework, or build step. Browser action -> `popup.html` -> `popup.css` + `popup.js` is the runtime path.
- The popup reads the active tab URL through `chrome.tabs.query`, derives `rootDomain` with `getRootDomain`, and toggles between root and current host with the `Root`/`Current` buttons.
- DNS queries use `fetch` against `PROVIDERS.cloudflare` and `PROVIDERS.google`; the resolver alternates through `chooseNextProvider` and is persisted as `lastProvider`.
- Cache entries are keyed by domain in `dnsCache`, mirrored in `memoryCache`, and expire after `CACHE_TTL_MS` (600 seconds). Refresh clears the active domain cache before lookup.

## Data And Validation

- Stored local data is `manualSelectors`, `dnsCache`, and `lastProvider` in `chrome.storage.local`; avoid adding new persisted data without updating `privacy-policy.html`.
- Common DKIM selectors live in `commonSelectors`; user-added selectors must pass `cleanSelector` before storage or lookup.
- SPF, DMARC, and DKIM validation is client-side in `validateSpf`, `validateDmarc`, and `validateDkimRecord`. Prefer extending those functions over scattering validation in render code.
- Render functions (`renderSpf`, `renderDmarc`, `renderDkim`, `renderNameserver`, `applyResults`) expect normalized payload shapes from `lookupDomain`.

## Theme And UI

- Preserve the light Sendmaster palette in CSS variables: `--light-green`, `--celadon`, `--pearl-aqua`, `--carrot-orange`, `--cinnabar`, `--deep-mocha`, `--paper`, `--panel`, `--line`, `--muted`.
- Status severity maps to `ok`, `warn`, `error`, and `neutral` classes. Keep visual state changes class-based so HTML, JS, and CSS stay aligned.
- The popup must remain usable inside a small browser extension viewport: avoid wide controls, long unwrapped text, or dependencies that require bundling.

## Change Guidelines

- Keep Chrome and Edge extension files synchronized after production changes.
- Use plain browser APIs and vanilla JavaScript; do not introduce a build system or framework unless explicitly requested.
- When changing permissions, network endpoints, storage behavior, or collected data, update both manifests as needed and revise `privacy-policy.html`.
- Preserve accessibility basics already present: labels, `aria-live` copy state, focus-visible styling, and semantic sections.