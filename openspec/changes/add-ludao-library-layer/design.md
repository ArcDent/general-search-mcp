## Context

gsearch already resolves one Engine per module: `src/search/tavily.ts` and
`src/crawl/firecrawl.ts` each own their tool definitions, client, formatters,
and handlers, while `src/config.ts` resolves every setting once and
`src/index.ts` only concatenates the exported arrays (see ADR-0001). The Ludao
REST API surfaces everything this change needs over plain GETs returning JSON,
including a download plan that lists per-part mirror URLs — the site itself
never proxies the bytes. See `proposal.md` for motivation and the
`library-layer` spec for the behavioural contract.

## Goals / Non-Goals

**Goals:**

- A Library Layer that follows the existing one-module-per-Engine shape, so the
  diff stays local: new file + config constants + a conditional spread in
  `index.ts`.
- A download path that is safe by construction: sanitised single-segment
  filenames, writes confined to the download directory, no partial files left
  on failure.
- Behaviour that is as forgiving as the site: guest mode without a token,
  graceful degradation instead of hard failures.

**Non-Goals:**

- Any write capability against the site (out of scope per the spec).
- Caching, indexing, or background prefetching of site data.
- Progress streaming to the client; the tool returns when the file is complete.
- A second HTTP client or streaming abstraction beyond what the project already
  has.

## Decisions

**Third module under `src/library/`, gated at registration time.**
`src/library/ludao.ts` exports `libraryTools` and `libraryHandlers` exactly like
the other two layers; `index.ts` spreads them only when
`LUDAO_ENABLED` is on. Both `listTools` and `--list-tools` read the same array,
so gating cannot drift between them.
*Alternative:* registering always and failing at call time — rejected, the spec
requires the tools to be absent from `listTools` when off, and it would leak a
third party's surface to every user.

**Reuse axios rather than `fetch`.**
`tavily.ts` already shapes errors via `axios.isAxiosError`, and axios gives
per-request `timeout` and `responseType: "stream"` without extra code. Adding
`fetch` would create a second error-handling idiom in one repo.
*Alternative:* `fetch` + `AbortSignal.timeout` — viable on Node ≥20, but loses
the uniform error mapping the Search Layer already established.

**Sequential mirror attempts, per part.**
For each part, try its URLs in plan order until one succeeds; each attempt uses
a 60s timeout. Sequential keeps peak bandwidth to one copy of a ≤95 MiB part and
stays far under the site's rate limit, and the plan's last entry (the GitHub
direct link) naturally becomes the final fallback.
*Alternative:* racing mirrors in parallel and taking the first — faster in the
happy path, but multiplies transferred bytes and complicates partial-file
cleanup for no gain at these part sizes.

**Write to `<final>.part`, rename on success.**
The unique final name is computed first (base name, then `_v2`, `_v3`, … if
taken), the bytes stream into `<final>.part`, and the file is renamed once every
part has landed. Any failure unlinks the temp file, so a failed download leaves
neither a truncated file nor a stray `.part`.
*Alternative:* appending directly to the final name — simpler, but a mid-way
failure leaves a plausible-looking truncated file behind.

**Filenames reduced to a single segment before any path is built.**
The plan's `filename` is trusted for its name only: directory components and
parent references are stripped, the result is joined to the download directory,
and the write path is always inside that directory.
*Alternative:* rejecting hostile names outright — worse UX; the material is
still downloadable under a safe name.

**Site errors mapped once, with hints.**
A single helper turns a non-2xx site response (`{"error": "…"}`) into a tool
error carrying the site message and status, adding a token/role hint on 403 and
a back-off hint on 429. All three tools share it.
*Alternative:* passing raw transport errors through — leaks stack noise and
gives the caller nothing to act on.

**Token forwarded only when present.**
`LUDAO_TOKEN` is resolved in `config.ts` and attached as
`Authorization: Bearer …` when non-empty; with no token the layer sends no
credential and runs as a guest. The token value is never interpolated into a
log line or tool output.
*Alternative:* failing fast without a token — rejected by the spec: public
materials need no credential.

## Risks / Trade-offs

- **The site is a third-party campus service** — it can change shape, rate-limit,
  or disappear without notice → the layer is off by default, responses are
  parsed defensively (optional fields, no assumed key order), and every failure
  surfaces as a tool error rather than a crash.
- **Invalid or revoked tokens degrade silently** (the site answers as a guest
  instead of 401) → documented in the tool descriptions and README; the download
  tool reports the identity it acted as.
- **A 60s per-attempt timeout can abort a slow-but-working mirror** → the next
  mirror in the plan is tried, and the GitHub direct link is the last resort;
  the result names the mirror that served the bytes so slow sources are visible.
- **Large materials (up to 2 GiB) occupy local disk** → no extra cap was added on
  purpose (per the agreed decision); the tool reports the byte count so the
  caller can judge, and the download directory is configurable.
- **Part counts exist only in the download plan** — the search and
  resource-detail endpoints report no part count (the detail's `series` field is
  null), so search output carries id/title/size/rating only and `ludao_download`
  is the sole source of a real part count. Surfacing it in search would cost one
  extra request per result.
- **Comments are offline site-side** — the site took comments down on 2026-09-30,
  so `/social` returns only the rating summary. The detail tool reports the
  rating and states plainly when a material has no reviews; if comments come
  back, the formatter already renders a list and needs no code change.
- **Part concatenation order matters** → parts are processed strictly by index
  and the total size is reported, so a wrong order would be visible.

## Migration Plan

No data migration. The layer is inert until `LUDAO_ENABLED` is set to a truthy
value, so rollout is: deploy, then enable per client config. Rollback is setting
the flag off — no code change required. Documentation (`.env.example`, README)
ships in the same change as the code.

## Open Questions

- **`peek` mode:** should the download tool accept a variant that resolves the
  plan without counting a download (the site's `peek=1`)? Deferrable — it adds a
  parameter, not a new behaviour class, and the default stays unchanged.
- **Category browsing:** a fourth tool for walking the category tree was cut from
  the surface. Deferrable — it would be a new tool in the same module, no change
  to the existing three.
