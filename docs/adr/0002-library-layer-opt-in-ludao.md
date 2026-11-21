---
status: superseded
---

> Superseded on 2026-11-21: Ludao support no longer ships on `main`. The
> Library Layer lives on the `ludao` branch, which follows `main` by merge; this
> record stays here as history and still describes that branch.

# The Library Layer is opt-in and prefixes its tools with `ludao_`

gsearch gains a third layer, the Library Layer, which searches, inspects, and
downloads study materials from the Ludao site (鹭岛书阁). Unlike the Search and
Crawl Layers — which stay exposed and degrade to keyless operation when their
credential is absent — the Library Layer is exposed only when `LUDAO_ENABLED`
is true, and absent is treated as false. Its tools are named `ludao_search`,
`ludao_resource`, and `ludao_download` rather than plain `search`/`resource`/
`download`, because the plain names already belong to the Tavily engine or read
as generic verbs.

## Considered Options

- **Opt-in flag, default off (chosen):** gsearch's own surface stays exactly as
  it is for every existing user. Ludao is a single-university site whose tools
  are noise for anyone not studying there, so a user who wants it says so
  explicitly. The flag is independent of `LUDAO_TOKEN`: with the layer on and no
  token, it runs in Guest mode against public resources, which needs no
  credential at all.
- **Follow the existing layers' pattern (exposed by default, credential gates
  capability):** consistent with Tavily/Firecrawl, but it silently ships a
  third-party campus site's tools to every user of this server.
- **Gate on `LUDAO_TOKEN` presence, no boolean:** fewer knobs, but it conflates
  "this server should offer material search" with "I hold a personal token",
  and the public search/download endpoints work without any token.
- **Unprefixed tool names with the layer implied:** rejected — `search` is
  already taken by Tavily, and `download` as a bare verb collides with nothing
  today but invites a future conflicting engine.

## Consequences

- New configuration items are `LUDAO_ENABLED`, `LUDAO_TOKEN`,
  `LUDAO_BASE_URL` (empty means the default site), and `LUDAO_DOWNLOAD_DIR`
  (empty means `./downloads` relative to the process cwd). All resolve in
  `config.ts`; the token never appears as a literal outside that module.
- The Library Layer never touches write endpoints (comments, ratings, uploads,
  review): the exposed surface is read-only search, detail, and download.
- With the flag off, no Ludao code path runs and no tool reaches `listTools`,
  so disabling costs nothing beyond the flag itself.
