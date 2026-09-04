# EMBERLINE — deployment options

## Recommendation

**Ship to GitHub Pages** via vinext's `output: "export"` + `assetPrefix`; runner-up **Cloudflare Workers**.
EMBERLINE is one route rendering a `"use client"` canvas component with `localStorage` saves, no fetches and
no D1/R2 use (`.openai/hosting.json` has `d1: null, r2: null`), so a server runtime buys nothing. I verified
locally that vinext 1.0.0-beta.2 fully prerenders it: `output: "export"` emits `dist/client/index.html` with
the entire RSC payload inlined in `<script>` bootstraps (no runtime `.rsc` fetch), and I then served that
export under a `/EMBERLINE/` path prefix and **played the game in headless Chromium** — hydration, render
loop and keyboard input all working, no 404s, no console errors. The repo is already on GitHub: no account, no
secret, zero cost, ~35 lines of CI. Two small source edits are needed, one of which (`headers()` in
`app/layout.tsx`) is what currently forces the route dynamic and is worth removing anyway. Runner-up
Cloudflare Workers needs **no code changes at all** — vinext already emits a complete
`dist/server/wrangler.json` that `wrangler deploy` accepts (verified via `--dry-run`); prefer it if the
owner already has a Cloudflare account or wants the D1 example to stay live. Vercel is a distant third: it
works only by discarding the Cloudflare plugin, or by shipping the same static export Pages hosts for free.

## Comparison

| | GitHub Pages | Cloudflare Workers | Vercel |
|---|---|---|---|
| Effort | Medium: 2 source edits + CI dir-move | **Lowest: no source edits** | High (Nitro) / same as Pages (static) |
| Cost | Free, no account needed | Free tier ample (below) | Free hobby tier |
| Custom domain | Yes (CNAME + repo setting) | Yes (Workers custom domain) | Yes |
| CI complexity | 2 jobs, no secrets | 1 job, 1 secret | Git integration, no CI file |
| What breaks | D1 example, worker image optimizer, `headers()` metadata, ChatGPT-auth helpers | nothing | `@cloudflare/vite-plugin`, `worker/index.ts`, D1 example |
| Verified? | **Yes — built, served under `/EMBERLINE/`, played in Chromium** | `wrangler deploy --dry-run` only | No — not attempted |

## Option 1 — GitHub Pages (recommended)

**Findings.** `npm run build` today produces **no static HTML**: `dist/client/` holds only assets and the
entry is `dist/server/index.js`, a Cloudflare Worker `{ fetch(request, env, ctx) }`; route `/` is reported
`? Unknown`. But vinext *does* support `output: "export"` (typed in `NextConfig`, implemented in
`node_modules/vinext/dist/build/run-prerender.js`, which writes prerendered HTML into `dist/client`), so no
custom Vite static entry is needed. Two things get in the way, both verified:

1. **Blocker.** With the current `app/layout.tsx`, export skips `/` —
   `{"status":"skipped","reason":"dynamic"}` in `dist/server/vinext-prerender.json`. Cause: `generateMetadata()`
   calls `headers()`. Remove it → `Prerendered 2 routes (0 skipped)` and a real `dist/client/index.html`.
2. **vinext bug.** `basePath: "/EMBERLINE"` + `output: "export"` *also* skips `/` as dynamic even with a
   fully static layout — the prerenderer renders `route.pattern` (`/`) while the handler expects
   `/EMBERLINE/`. vinext's README claims full `basePath` support, so this is an undocumented beta.2 gap.
   **Use `assetPrefix` instead**, which I verified works with export.

With `assetPrefix: "/EMBERLINE"` the HTML references `/EMBERLINE/_next/...` but files land in
`dist/client/EMBERLINE/_next/...`, so CI must move that directory up one level. The game's art is all canvas
drawing — no `/public` URLs in `EmberlineGame.tsx` — so gameplay is base-path-agnostic.

**End-to-end proof.** I built exactly the recipe below, flattened the tree, served it under a `/EMBERLINE/`
prefix and drove it in headless Chromium: every asset 200, **no 404s, no page errors**, React hydrated (the
"Begin a new shift" button responded to a click), the 1280x800 canvas mounted and its pixels changed between
frames (render loop running) and again after an ArrowUp thrust input. Screenshot of the running game:
a local headless-Chromium run (not committed). `npm test` also passes against the export build (2/2).

**Code changes.**

1. `next.config.ts` — gate export so the default Cloudflare/Sites build is unchanged:
   ```ts
   const nextConfig: NextConfig = {
     ...(process.env.STATIC_EXPORT ? { output: "export" as const } : {}),
     assetPrefix: process.env.ASSET_PREFIX || undefined,
     images: { unoptimized: true },
   };
   ```
2. `app/layout.tsx` — drop `import { headers } from "next/headers"`, make `generateMetadata` synchronous:
   ```ts
   export function generateMetadata(): Metadata {
     const base = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
     const image = new URL("og.png", base).toString(); // NOT "/og.png" — a leading slash drops /EMBERLINE
   ```
   In my build `new URL("/og.png", base)` produced `https://89huey89.github.io/og.png`, wrong for a project
   page. Use the relative form plus a trailing slash on `NEXT_PUBLIC_SITE_URL`.
3. Repo settings → Pages → Source: **GitHub Actions**.

**`.github/workflows/pages.yml`**

```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - name: Build static export
        env:
          STATIC_EXPORT: "1"
          ASSET_PREFIX: /EMBERLINE
          NEXT_PUBLIC_SITE_URL: https://89huey89.github.io/EMBERLINE/
        run: npm run build
      - name: Flatten assetPrefix dir into the Pages root
        run: |
          mv dist/client/EMBERLINE/_next dist/client/_next
          rmdir dist/client/EMBERLINE
          touch dist/client/.nojekyll   # belt-and-braces: _next starts with an underscore
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist/client }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

For a custom domain later: drop `ASSET_PREFIX` and the flatten step, point `NEXT_PUBLIC_SITE_URL` at it.

## Option 2 — Cloudflare Workers (runner-up)

`npm run build` already emits `dist/server/wrangler.json` (name `emberline-browser-game`, `nodejs_compat`,
`assets.directory: ../client`, `main: index.js`). `npx wrangler deploy --dry-run -c dist/server/wrangler.json`
succeeded: 35 modules / 553 KiB (217 KiB gzip, far under the 3 MiB free-plan Worker limit), 37 asset files.
Minimum CI, plus an "Edit Cloudflare Workers" token in repo secrets:

```yaml
      - run: npm ci && npm run build
      - run: npx wrangler deploy -c dist/server/wrangler.json
        env: { CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}" }
```

vinext's own path is `npx @vinext/cloudflare deploy` (`vinext deploy` is removed and prints exactly that);
that package isn't a dependency, so the raw `wrangler deploy` avoids adding one. Free tier is ample: static
asset requests are free and unlimited on Workers, and only Worker invocations count against 100k/day. HTML
for `/` is Worker-rendered unless you also set `output: "export"`, in which case it is served from assets.
No source changes; D1, the image optimizer and the ChatGPT-auth helpers all keep working. Downside: a
Cloudflare account and a long-lived API token in the repo.

## Option 3 — Vercel

vinext does **not** run on Vercel natively — there is no vinext framework preset. Two routes: **Nitro (SSR)**,
which vinext's README documents as adding `nitro/vite` beside `vinext()` and building with
`NITRO_PRESET=vercel` — that means dropping `cloudflare()` from `vite.config.ts` (losing binding simulation
and `worker/index.ts`), adding a `nitro` dep, and deleting `db/index.ts` (it imports `cloudflare:workers`)
plus `examples/d1/`. Or **static**: the same `output: "export"` build with preset "Other", build command
`npm run build`, output directory `dist/client`, no `assetPrefix` — strictly worse than Pages here, same
work plus an extra account. A full conversion back to real Next.js (swap `vinext` for `next`, rewrite the
scripts, delete `vite.config.ts`, `build/sites-vite-plugin.ts`, `worker/`, the Cloudflare deps) is possible
but large for a game that needs no server.

## Option 4 — the existing OpenAI Sites hosting

`.openai/hosting.json` (`project_id: appgprj_…`, `d1: null`, `r2: null`) plus `build/sites-vite-plugin.ts`
(which copies it and `drizzle/` into `dist/.openai/`) show the repo was scaffolded from the `vinext-starter`
template for **OpenAI Sites**, a Cloudflare-Worker-shaped host that injects `oai-authenticated-user-*`
headers. It is a control-plane manifest, not a build input: keeping it costs nothing and conflicts with
none of the above — Pages and Vercel ignore `dist/.openai/`, and Cloudflare's `.assetsignore` already
excludes the wrangler config from asset upload. The only interaction is that `output: "export"` should stay
env-gated (Option 1) so a Sites deploy still gets the default Worker build.

## Unverified

- The real GitHub Pages environment (I simulated it with a local static server under a `/EMBERLINE/` path
  prefix; Pages' own routing/redirect behaviour for the project root is assumed, not tested).
- An actual `wrangler deploy` (dry-run only — no Cloudflare account here).
- The Nitro/Vercel path, and whether the OpenAI Sites project is still live.
- Whether the vinext `basePath` + export bug is fixed after 1.0.0-beta.2.

Sources: [cloudflare/vinext](https://github.com/cloudflare/vinext) ·
[actions/deploy-pages](https://github.com/actions/deploy-pages) ·
[actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact) ·
[Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) ·
[Vite + Nitro on Vercel](https://vercel.com/docs/frameworks/full-stack/vite-with-nitro)
