/**
 * Library Layer — Ludao (鹭岛书阁) engine.
 *
 * Exposes read-only tools over the Ludao material-sharing site:
 *  - `ludao_search` : full-text search returning materials (resources) by
 *                     default, or matching categories on request
 *  - `ludao_resource` : one material's metadata, rating summary and reviews,
 *                     read by its resource id (category ids are not resource
 *                     ids, so they report "not found" instead)
 *  - `ludao_download` : one material written to local disk — the download plan
 *                     is resolved, each part streams through the plan's mirror
 *                     order into `<final>.part`, and the file is renamed once
 *                     every part has landed (multi-part materials are
 *                     concatenated in part order)
 *
 * Talks to the Ludao REST API (default https://xmu.vintces.icu/api) over
 * axios. Runs as a guest when LUDAO_TOKEN is absent: public materials stay
 * searchable and no credential is sent. Non-2xx site responses (the site
 * answers `{"error": "…"}`) are mapped to tool errors carrying the site
 * message and HTTP status, with hints on 403/429. Nothing here changes site
 * state.
 */
import { createWriteStream } from "node:fs";
import {
  mkdir,
  rename,
  stat,
  truncate as truncateFile,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import axios, { AxiosInstance } from "axios";
import { LUDAO_BASE_URL, LUDAO_DOWNLOAD_DIR, LUDAO_TOKEN } from "../config.js";
import {
  cleanParams,
  textResult,
  truncate,
  type ToolDefinition,
  type ToolHandler,
  type ToolResult,
} from "../types.js";

let axiosInstance: AxiosInstance | null = null;

function client(): AxiosInstance {
  if (axiosInstance) return axiosInstance;
  axiosInstance = axios.create({
    baseURL: LUDAO_BASE_URL,
    headers: {
      accept: "application/json",
      // Guest mode sends no credential at all.
      ...(LUDAO_TOKEN ? { Authorization: `Bearer ${LUDAO_TOKEN}` } : {}),
    },
  });
  return axiosInstance;
}

// ---------------------------------------------------------------------------
// Site error mapping — one helper shared by every tool in this layer.
// ---------------------------------------------------------------------------

/** Whatever was thrown, reduced to one line: an Error keeps its message, any
 *  other value is stringified. Shared so every error report reads the same. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The site answers errors as `{"error": "…"}`. Other bodies happen too: HTML
 * error pages, plain-text rejections (`duplicate field \`tag\``). They are
 * passed through as text so the caller still sees the site's own words.
 */
function siteMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.trim() || undefined;
  if (body && typeof body === "object") {
    const { error } = body as { error?: unknown };
    if (typeof error === "string" && error) return error;
    return JSON.stringify(body);
  }
  return undefined;
}

function ludaoError(where: string, error: unknown): ToolResult {
  if (!axios.isAxiosError(error)) {
    const message = errorMessage(error);
    return textResult(
      `Ludao ${where} error (site: ${LUDAO_BASE_URL}): ${message}`,
      true,
    );
  }
  const status = error.response?.status;
  const detail = siteMessage(error.response?.data) ?? error.message;
  let message = `Ludao ${where} error (site: ${LUDAO_BASE_URL}${
    status != null ? `, HTTP ${status}` : ""
  }): ${detail}`;
  if (status === 403) {
    message +=
      "\nHint: the site denied permission. Check the configured LUDAO_TOKEN — it may be missing, revoked, or its owner's role may be too low (guests only reach public materials).";
  } else if (status === 429) {
    message +=
      "\nHint: the site is rate-limiting this caller. Back off and retry later.";
  }
  return textResult(message, true);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const ludaoSearchTool: ToolDefinition = {
  name: "ludao_search",
  description:
    "Search the Ludao material-sharing site (鹭岛书阁) for study materials with its full-text search. Returns materials — each with resource id, course/title, size, and rating — by default; set result_type to 'category' to browse matching categories instead. Supports Chinese, course codes, and pinyin initials. Public materials are searchable without a token.",
  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description:
          "Search query. Supports Chinese, course codes, and pinyin initials (e.g. wjf for 微积分).",
      },
      tag: {
        type: "string",
        description:
          "Filter by one tag code (T1–T9, e.g. T1 for 真题试卷). The site accepts a single tag per search.",
      },
      within: {
        type: "integer",
        description:
          "Category id — restrict results to that category subtree (subtree restriction). Ids come from category results (result_type: 'category') or the site's category tree; resource ids are not category ids.",
      },
      page: {
        type: "integer",
        description:
          "Page number (default 1). The site fixes the page size at 20 results per page and caps pages at 50; pages past the last one return nothing.",
        default: 1,
        minimum: 1,
      },
      result_type: {
        type: "string",
        enum: ["resource", "category"],
        description:
          "Result type: 'resource' returns materials (default); 'category' returns matching categories instead of materials.",
        default: "resource",
      },
    },
    required: ["q"],
  },
};

/**
 * Read one material by its resource id. The id is the material's own id (the
 * `#…` shown by `ludao_search`), never a category id: the site keeps two id
 * spaces and `/api/nodes/{id}` answers 404 for a resource id and vice versa.
 */
const ludaoResourceTool: ToolDefinition = {
  name: "ludao_resource",
  description:
    "Read one material (资源) from the Ludao material-sharing site (鹭岛书阁) by its resource id and report its metadata — filename, course, term, type word, size, download count, and status — together with the site's rating summary and review list. The input is a material id as returned by ludao_search (e.g. the #685 shown there), NOT a category id: category ids and resource ids are different id spaces and a category id will be reported as not found. Public materials are readable without a token; an id that does not exist, or is not visible to the caller's identity (guest or token), is reported as not found. This read-only tool never changes site state. To obtain study files rather than read about them, use the id from the metadata.",
  inputSchema: {
    type: "object",
    properties: {
      resource_id: {
        type: "integer",
        description:
          "The material's resource id — the #id listed by ludao_search results. This is a resource id, not a category id (分类 id): category ids and resource ids are not interchangeable, and passing a category id reports the material as not found.",
        minimum: 1,
      },
    },
    required: ["resource_id"],
  },
};

// ---------------------------------------------------------------------------
// Formatters — defensive against the site's rich, evolving response shapes.
// ---------------------------------------------------------------------------

const MAX_SEARCH_CHARS = 12000;
const MAX_RESOURCE_CHARS = 16000;
const MAX_REVIEWS = 50;

interface ResourceName {
  course?: string;
  time?: string;
  type_word?: string;
  paper?: string;
  with_answer?: boolean;
}

interface ResourceItem {
  id?: number;
  title?: string;
  filename?: string;
  size?: number | null;
  name?: ResourceName;
  node?: { id?: number; label?: string; name?: string; kind?: string };
  tag?: { code?: string; label?: string };
  rating?: { avg?: number | null; count?: number | null } | null;
}

interface NodeItem {
  id?: number;
  label?: string;
  name?: string;
  kind?: string;
  count?: number | null;
}

interface SearchItem {
  type?: string;
  resource?: ResourceItem;
  node?: NodeItem;
  path?: Array<{ label?: string; name?: string }>;
}

interface SearchPayload {
  items?: SearchItem[];
  page?: number;
  page_size?: number;
  total?: number;
}

function formatSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "?";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

function formatResource(resource: ResourceItem, index: number): string {
  const name = resource.name ?? {};
  const rating = resource.rating ?? {};
  const avg = typeof rating.avg === "number" ? rating.avg.toFixed(1) : "?";
  const votes = typeof rating.count === "number" ? String(rating.count) : "?";
  const details = [
    name.time,
    name.type_word,
    name.paper,
    name.with_answer ? "with answer" : "",
  ].filter((bit): bit is string => Boolean(bit));
  const node = resource.node ?? {};
  const category = node.label || node.name || "?";
  return [
    `[${index + 1}] #${resource.id ?? "?"} ${resource.title || resource.filename || "(untitled)"}`,
    `    ${details.length > 0 ? `${details.join(" · ")} | ` : ""}Tag: ${resource.tag?.code ?? "?"} | Category: ${category} (#${node.id ?? "?"})`,
    `    Size: ${formatSize(resource.size)} | Rating: ${avg} (${votes} votes)`,
  ].join("\n");
}

function formatNode(node: NodeItem, path: SearchItem["path"], index: number): string {
  const label = node.label || node.name || "(unnamed)";
  const count = typeof node.count === "number" ? node.count : "?";
  const bits = [`Materials: ${count}`];
  if (node.name && node.name !== label) bits.push(`Name: ${node.name}`);
  const breadcrumb = (path ?? [])
    .map((step) => step.label || step.name || "")
    .filter(Boolean)
    .join(" / ");
  if (breadcrumb) bits.push(`Path: ${breadcrumb}`);
  return [
    `[${index + 1}] #${node.id ?? "?"} ${label} (${node.kind ?? "?"})`,
    `    ${bits.join(" | ")}`,
  ].join("\n");
}

function formatSearch(
  data: SearchPayload,
  kind: "resource" | "node",
  q: string,
): string {
  const items = Array.isArray(data.items) ? data.items : [];
  const noun = kind === "resource" ? "materials" : "categories";
  const page = typeof data.page === "number" ? data.page : 1;
  const total = typeof data.total === "number" ? data.total : 0;
  if (items.length === 0) {
    return total > 0
      ? `No ${noun} on page ${page} (${total} ${noun} in total).`
      : `No ${noun} matched "${q}".`;
  }
  const out = [
    `Found ${total} ${noun} (page ${page}${
      typeof data.page_size === "number" ? `, ${data.page_size} per page` : ""
    }):`,
  ];
  for (const [index, item] of items.entries()) {
    out.push("");
    // Route by the item's own type when present; the requested kind is the
    // default. One search never mixes both in this layer.
    const itemKind =
      item.type === "resource" || item.type === "node" ? item.type : kind;
    out.push(
      itemKind === "resource"
        ? formatResource(item.resource ?? {}, index)
        : formatNode(item.node ?? {}, item.path, index),
    );
  }
  if (items.length < total) {
    out.push(
      `\nPage ${page} shows ${items.length} of ${total} ${noun}; pass page to see more.`,
    );
  }
  return truncate(out.join("\n"), MAX_SEARCH_CHARS);
}

// ---------------------------------------------------------------------------
// Resource detail — metadata + rating summary + review list.
// ---------------------------------------------------------------------------

/** `/api/resources/{id}` returns one material. `series` is always null on this
 *  endpoint (part counts live only in the download plan), so it is not shown. */
interface ResourceDetailPayload {
  id?: number;
  title?: string;
  filename?: string;
  ext?: string;
  mime?: string;
  major?: string;
  size?: number | null;
  downloads?: number | null;
  status?: string;
  note?: string;
  subtitle?: string;
  created_at?: number | null;
  updated_at?: number | null;
  name?: ResourceName;
  node?: { id?: number; label?: string; name?: string; kind?: string };
  path?: Array<{ label?: string; name?: string }>;
  tag?: { code?: string; label?: string };
  rating?: { avg?: number | null; count?: number | null } | null;
}

/** `/api/resources/{id}/social` carries the rating summary, this viewer's own
 *  rating, and the review list. The list is absent while a material has no
 *  reviews, so every field stays optional. */
interface SocialPayload {
  rating?: { avg?: number | null; count?: number | null } | null;
  my_rating?: number | null;
  reviews?: SocialReview[] | null;
}

interface SocialReview {
  id?: number;
  nickname?: string;
  role?: string;
  body?: string;
  created_at?: number | null;
  stars?: number | null;
  mine?: boolean;
}

/** Unix seconds → `YYYY-MM-DD`, or "?" when the site omits the timestamp. */
function formatDate(epoch: number | null | undefined): string {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return "?";
  const date = new Date(epoch * 1000);
  if (Number.isNaN(date.getTime())) return "?";
  return date.toISOString().slice(0, 10);
}

function formatRating(rating: ResourceDetailPayload["rating"]): string {
  const avg = typeof rating?.avg === "number" ? rating.avg.toFixed(1) : "?";
  const count = typeof rating?.count === "number" ? String(rating.count) : "?";
  return `${avg} (${count} votes)`;
}

function formatReview(review: SocialReview, index: number): string {
  const who = [review.nickname || "(anonymous)", review.role].filter(Boolean).join(" · ");
  const stars =
    typeof review.stars === "number" && review.stars > 0
      ? ` · ★${review.stars}`
      : "";
  const body = (review.body ?? "").trim();
  return [
    `[${index + 1}] #${review.id ?? "?"} ${who}${review.mine ? " (you)" : ""}`,
    `    ${formatDate(review.created_at)}${stars}`,
    `    ${body || "(empty)"}`,
  ].join("\n");
}

function formatResourceDetail(
  data: ResourceDetailPayload,
  social: SocialPayload,
): string {
  const name = data.name ?? {};
  const node = data.node ?? {};
  const rating = social.rating ?? data.rating ?? {};
  const category = node.label || node.name || "?";
  const details = [
    name.time,
    name.type_word,
    name.paper,
    name.with_answer ? "with answer" : "",
  ].filter((bit): bit is string => Boolean(bit));
  const out = [
    `#${data.id ?? "?"} ${data.title || data.filename || "(untitled)"}`,
    `    Filename: ${data.filename || "?"}`,
    `    Course: ${name.course || "?"}${
      details.length > 0 ? ` | Term/type: ${details.join(" · ")}` : ""
    }`,
    `    Size: ${formatSize(data.size)} | File type: ${data.mime || "?"}${
      data.ext ? ` (.${data.ext})` : ""
    }`,
    `    Downloads: ${
      typeof data.downloads === "number" ? data.downloads : "?"
    } | Status: ${data.status || "?"}`,
    `    Category: ${category} (#${node.id ?? "?"}) | Tag: ${
      data.tag?.code ?? "?"
    }${data.tag?.label ? ` ${data.tag.label}` : ""}`,
  ];
  const breadcrumb = (data.path ?? [])
    .map((step) => step.label || step.name || "")
    .filter(Boolean)
    .join(" / ");
  if (breadcrumb) out.push(`    Path: ${breadcrumb}`);
  if (data.subtitle) out.push(`    Subtitle: ${data.subtitle}`);
  if (data.note) out.push(`    Note: ${data.note}`);
  out.push(
    `    Uploaded: ${formatDate(data.created_at)}${
      typeof data.updated_at === "number" &&
      data.updated_at !== data.created_at
        ? ` | Updated: ${formatDate(data.updated_at)}`
        : ""
    }`,
  );

  out.push("", "Rating summary:");
  out.push(`    Average: ${formatRating(rating)}`);
  out.push(
    `    My rating: ${
      typeof social.my_rating === "number" ? social.my_rating : "?"
    } (0 = not rated)`,
  );

  out.push("", "Reviews:");
  const reviews = Array.isArray(social.reviews) ? social.reviews : [];
  if (reviews.length === 0) {
    out.push("    No reviews on the site for this material.");
  } else {
    for (const [index, review] of reviews
      .slice(0, MAX_REVIEWS)
      .entries()) {
      out.push("", formatReview(review, index));
    }
    if (reviews.length > MAX_REVIEWS) {
      out.push(
        `\n    Showing ${MAX_REVIEWS} of ${reviews.length} reviews.`,
      );
    }
  }
  return truncate(out.join("\n"), MAX_RESOURCE_CHARS);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** The site accepts exactly one tag per search; a stray array (some clients
 *  send those) is reduced to its first entry rather than duplicated into the
 *  query string, which the site rejects with 400. */
function tagValue(tag: unknown): string | undefined {
  const first = Array.isArray(tag) ? tag[0] : tag;
  if (first == null) return undefined;
  const value = typeof first === "string" ? first.trim() : String(first);
  return value || undefined;
}

const handleSearch: ToolHandler = async (args) => {
  // Resources are the default; only an explicit category request switches.
  const kind = args.result_type === "category" ? "node" : "resource";
  try {
    const q = String(args.q ?? "").trim();
    const res = await client().get("/search", {
      params: cleanParams({
        q,
        type: kind,
        tag: tagValue(args.tag),
        within: args.within,
        page: args.page,
      }),
    });
    return textResult(formatSearch(res.data, kind, q));
  } catch (error) {
    return ludaoError("search", error);
  }
};

/** The site answers 404 with `{"error":"未找到：资料"}` for an unknown id and
 *  for a material the viewer may not see, so both collapse to "not found". */
function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

/** Both read tools take the same `resource_id` argument and reject the same
 *  wrong values with the same words, so the check lives here once. `tool`
 *  names the caller ("resource" or "download") so the error says which tool
 *  was addressed; a valid id comes back as `{ id }` and a rejected one as
 *  `{ error }` — the text to return as the tool error. */
function resourceIdArg(
  args: Record<string, unknown>,
  tool: string,
): { id: number } | { error: string } {
  const raw = args.resource_id;
  const id = typeof raw === "number" ? raw : Number(raw);
  if (Number.isInteger(id) && id >= 1) return { id };
  return {
    error: `Ludao ${tool} error: a positive resource id is required (the #id shown by ludao_search, not a category id), got ${
      raw === undefined ? "nothing" : JSON.stringify(raw)
    }.`,
  };
}

/** The words both read tools answer an id the site 404s with: it may not
 *  exist, or the material may not be visible to this viewer. */
function resourceNotFoundText(id: number): string {
  return `Ludao resource ${id} was not found on the site. The id may not exist, or the material may not be visible to you — guests only reach published materials, and category (节点) ids are not resource ids.`;
}

const handleResource: ToolHandler = async (args) => {
  const arg = resourceIdArg(args, "resource");
  if ("error" in arg) return textResult(arg.error, true);
  const id = arg.id;
  let data: ResourceDetailPayload = {};
  try {
    const res = await client().get(`/resources/${id}`);
    if (res.data && typeof res.data === "object") {
      data = res.data as ResourceDetailPayload;
    }
  } catch (error) {
    // 404 covers both an unknown id and a material the viewer may not see.
    return isNotFound(error)
      ? textResult(resourceNotFoundText(id), true)
      : ludaoError("resource", error);
  }
  // The rating summary and reviews are a second call; losing them must not
  // discard metadata that already arrived, so a failure degrades to a note.
  let social: SocialPayload = {};
  let socialNote: string | undefined;
  try {
    const socialRes = await client().get(`/resources/${id}/social`);
    if (socialRes.data && typeof socialRes.data === "object") {
      social = socialRes.data as SocialPayload;
    }
  } catch (error) {
    if (isNotFound(error)) {
      socialNote = "Rating summary: not found for this material.";
    } else {
      socialNote = `Rating summary unavailable: ${
        ludaoError("resource social", error).content[0].text
      }`;
    }
  }
  return textResult(
    socialNote
      ? `${formatResourceDetail(data, {})}\n\n${socialNote}`
      : formatResourceDetail(data, social),
  );
};

// ---------------------------------------------------------------------------
// ludao_download — plan fetch, safe naming, streaming parts to disk.
// ---------------------------------------------------------------------------

/** `/api/resources/{id}/download` returns the plan: the site records `size`
 *  and `filename` at the top level — its `mime` is deliberately not carried,
 *  since the file type belongs to `ludao_resource` and nothing on this path
 *  reads it — and lists one entry per part, each with its own `size`, `sha256`
 *  and the mirror `urls` to try in order (the last one is the GitHub direct
 *  link). No `index` field was observed, so the array position is the part
 *  sequence. Everything is parsed defensively — optional fields, no assumed
 *  key order, a missing `parts` list reads as one part. */
interface PlanPart {
  /** 1-based sequence of this part in the plan. */
  seq: number;
  size?: number;
  urls: string[];
}

interface DownloadPlan {
  filename?: string;
  size?: number;
  parts: PlanPart[];
}

/** One mirror attempt is bounded so a slow source yields to the next one. */
const PART_TIMEOUT_MS = 60000;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : [];
}

function parseDownloadPlan(data: unknown): DownloadPlan | undefined {
  if (!data || typeof data !== "object") return undefined;
  const plan = data as {
    filename?: unknown;
    size?: unknown;
    parts?: unknown;
    urls?: unknown;
  };
  // A missing or empty parts list degrades to a single part, matching the
  // one-part shape every material under 95 MiB already uses.
  const entries =
    Array.isArray(plan.parts) && plan.parts.length > 0 ? plan.parts : [plan];
  const parts: PlanPart[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const part = entry as { size?: unknown; urls?: unknown };
    parts.push({
      seq: parts.length + 1,
      size: typeof part.size === "number" ? part.size : undefined,
      urls: stringList(part.urls),
    });
  }
  return {
    filename: typeof plan.filename === "string" ? plan.filename : undefined,
    size: typeof plan.size === "number" ? plan.size : undefined,
    parts,
  };
}

/** Characters unsafe in one path segment on the platforms the server runs on:
 *  control bytes plus the Windows-reserved set. Separators are already gone by
 *  the segment reduction, so they are not listed here. */
const UNSAFE_NAME_CHARS = /[\u0000-\u001f<>:"|?*]/g;
/** Keep the name comfortably inside the usual 255-byte filesystem limit. */
const MAX_NAME_LENGTH = 200;

/**
 * Reduce the plan's filename to a single safe segment: directory components in
 * both separator styles and parent references are stripped, unsafe characters
 * dropped, and an empty or dot-only result falls back to `resource-<id>`. The
 * name can never carry a directory, so writes stay inside the download
 * directory.
 */
function safeFilename(raw: unknown, id: number): string {
  const unified = typeof raw === "string" ? raw.replace(/\\/g, "/") : "";
  const segment = path.basename(unified).replace(UNSAFE_NAME_CHARS, "").trim();
  let name =
    segment === "" || segment === "." || segment === ".." || segment === "/"
      ? `resource-${id}`
      : segment;
  if (name.length > MAX_NAME_LENGTH) {
    const ext = path.extname(name);
    name = `${name.slice(0, MAX_NAME_LENGTH - ext.length)}${ext}`;
  }
  return name;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    // Only a missing file means "this name is free". Every other stat failure
    // (permissions, symlink loops) is a real problem and must surface rather
    // than pass for a free name.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * First free name in the directory: `a.pdf` → `a_v2.pdf`, `a_v3.pdf`, … The
 * suffix is inserted before the extension so the file type stays visible, and
 * an existing file is never read, written, or moved. The suffix adds no
 * separator, so the result stays the single segment `name` already was and the
 * write path stays inside `dir`; a non-ENOENT stat failure is thrown rather
 * than mistaken for a free name.
 */
async function uniqueFilename(dir: string, name: string): Promise<string> {
  if (!(await fileExists(path.join(dir, name)))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let version = 2; ; version += 1) {
    const candidate = `${stem}_v${version}${ext}`;
    if (!(await fileExists(path.join(dir, candidate)))) return candidate;
  }
}

/**
 * Stream one mirror's bytes into the temp file, appended at the part's
 * committed offset: the temp file is first rolled back to that offset, so the
 * bytes of a failed attempt are always discarded before the next mirror
 * appends. A failed attempt therefore leaves nothing but a retry, and the file
 * renamed at the end can only ever hold committed bytes. Rejects on transport
 * failure or mid-stream error; the caller then tries the next mirror.
 */
async function fetchPartToDisk(
  url: string,
  tempPath: string,
  committedBytes: number,
): Promise<void> {
  // An absolute mirror URL bypasses the instance baseURL, as axios does for
  // every absolute target.
  const res = await client().get(url, {
    responseType: "stream",
    timeout: PART_TIMEOUT_MS,
  });
  // Roll any bytes an earlier failed attempt of this part already wrote back
  // to the part's starting offset; a temp file shorter than that offset needs
  // no truncation.
  const landed = await stat(tempPath)
    .then((entry) => entry.size)
    .catch(() => 0);
  if (landed > committedBytes) {
    await truncateFile(tempPath, committedBytes);
  }
  await pipeline(res.data, createWriteStream(tempPath, { flags: "a" }));
}

/** One line per failed mirror: the URL plus its status/code and the
 *  transport's own words, so the last failure reason is actionable. */
function mirrorFailure(url: string, error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const kind = status != null ? `HTTP ${status}` : (error.code ?? "request failed");
    return `${url} (${kind}): ${error.message}`;
  }
  return `${url}: ${errorMessage(error)}`;
}

const handleDownload: ToolHandler = async (args) => {
  const arg = resourceIdArg(args, "download");
  if ("error" in arg) return textResult(arg.error, true);
  const id = arg.id;
  const dirArg = typeof args.output_dir === "string" ? args.output_dir.trim() : "";
  const downloadDir = path.resolve(dirArg || LUDAO_DOWNLOAD_DIR);

  // 1) Resolve the download plan. The site only lists storage mirrors here;
  //    the bytes never pass through it.
  let plan: DownloadPlan;
  try {
    const res = await client().get(`/resources/${id}/download`);
    const parsed = parseDownloadPlan(res.data);
    if (!parsed || parsed.parts.every((part) => part.urls.length === 0)) {
      return textResult(
        `Ludao download error (resource ${id}): the site returned a download plan without mirror URLs, so there is nothing to download.`,
        true,
      );
    }
    plan = parsed;
  } catch (error) {
    return isNotFound(error)
      ? textResult(resourceNotFoundText(id), true)
      : ludaoError("download", error);
  }

  // 2) Reduce the plan filename to one segment — safeFilename guarantees it
  //    carries no directory, so the write path stays inside downloadDir — then
  //    take a free name in that directory before any byte moves.
  const filename = safeFilename(plan.filename, id);
  let uniqueName: string;
  try {
    uniqueName = await uniqueFilename(downloadDir, filename);
  } catch (error) {
    // uniqueFilename only fails on a real stat problem (permissions, symlink
    // loops), which fileExists no longer hides as "the name is free".
    return textResult(
      `Ludao download error (resource ${id}): cannot pick a free output name in ${downloadDir}: ${errorMessage(error)}`,
      true,
    );
  }
  const targetPath = path.resolve(downloadDir, uniqueName);
  const tempPath = `${targetPath}.part`;

  // 3) Stream every part through the mirrors in plan order. A single attempt
  //    that fails — including a timeout — falls through to the next mirror;
  //    only a part whose every mirror failed aborts the download.
  try {
    await mkdir(downloadDir, { recursive: true });
  } catch (error) {
    return textResult(
      `Ludao download error (resource ${id}): cannot create the download directory ${downloadDir}: ${errorMessage(error)}`,
      true,
    );
  }
  const mirrors: Array<{ seq: number; url: string }> = [];
  try {
    // Bytes already committed in the temp file by the parts before the current
    // one. Every part appends from here, and each mirror attempt first rolls
    // the temp file back to this offset, so a failed attempt contributes
    // nothing to the file that is finally renamed.
    let committedBytes = 0;
    for (const part of plan.parts) {
      let landed = false;
      let lastFailure: string | undefined;
      for (const url of part.urls) {
        try {
          await fetchPartToDisk(url, tempPath, committedBytes);
          mirrors.push({ seq: part.seq, url });
          landed = true;
          break;
        } catch (error) {
          lastFailure = mirrorFailure(url, error);
        }
      }
      if (!landed) {
        throw new Error(
          `part ${part.seq} of ${plan.parts.length} failed on all ${part.urls.length} mirror(s); last failure: ${
            lastFailure ?? "unknown"
          }`,
        );
      }
      // Read the offset back from disk rather than trusting the plan's size:
      // the next part must append after the bytes that actually landed.
      committedBytes = (await stat(tempPath)).size;
    }
    // Every part landed: swap the temp file in atomically (same directory).
    await rename(tempPath, targetPath);
  } catch (error) {
    // A failure must leave neither a truncated file nor a stray .part.
    await unlink(tempPath).catch(() => undefined);
    const message = errorMessage(error);
    return textResult(
      `Ludao download error (resource ${id}): ${message} No partial file was left behind.`,
      true,
    );
  }

  // 4) Report the result: absolute path, on-disk bytes, part count, mirrors.
  //    The plan's own total is computed once: it is the fallback byte count
  //    and the cross-check against what actually landed on disk.
  const planTotal =
    plan.size ?? plan.parts.reduce((sum, part) => sum + (part.size ?? 0), 0);
  let bytes = planTotal;
  try {
    bytes = (await stat(targetPath)).size;
  } catch {
    // Fall back to the plan's total if the fresh file cannot be stated.
  }
  const out = [
    `Ludao download complete (resource ${id}, identity: ${
      LUDAO_TOKEN ? "authenticated (LUDAO_TOKEN configured)" : "guest"
    }):`,
    `    Saved to: ${targetPath}`,
    `    Filename: ${uniqueName}${uniqueName === filename ? "" : ` (plan filename: ${filename})`}`,
    `    Size: ${bytes} bytes (${formatSize(bytes)}) | Parts: ${plan.parts.length}`,
  ];
  if (planTotal > 0 && planTotal !== bytes) {
    out.push(
      `    Note: the plan reported ${planTotal} bytes, the file on disk has ${bytes} bytes.`,
    );
  }
  out.push("    Mirror(s) that served the bytes:");
  for (const { seq, url } of mirrors) {
    out.push(`      part ${seq}: ${url}`);
  }
  return textResult(out.join("\n"));
}

const ludaoDownloadTool: ToolDefinition = {
  name: "ludao_download",
  description:
    "Download one material (资源) from the Ludao material-sharing site (鹭岛书阁) to the local disk by its resource id. Resolves the material's download plan, then streams every part through the plan's mirror URLs in order — each attempt times out after 60 seconds and the plan's last entry (the GitHub direct link) is the final fallback — concatenating multi-part materials in part order into a single file. Output goes under the download directory (the LUDAO_DOWNLOAD_DIR setting, default ./downloads relative to the server process's working directory; override per call with output_dir). The output name is reduced to a single safe path segment inside that directory; when it is already taken the file is written as _v2, _v3, … and existing files are never touched. Any failure leaves no partial file behind. The result reports the absolute output path, the byte count, the number of parts, and the mirror that served the bytes. Public materials are downloadable without a token; an id that does not exist, or is not visible to the caller's identity, is reported as an error. Use the resource id from ludao_search, not a category id.",
  inputSchema: {
    type: "object",
    properties: {
      resource_id: {
        type: "integer",
        description:
          "The material's resource id — the #id listed by ludao_search results. This is a resource id, not a category id (分类 id): category ids and resource ids are not interchangeable, and passing a category id reports the material as not found.",
        minimum: 1,
      },
      output_dir: {
        type: "string",
        description:
          "Directory the downloaded file is written to (created when missing). Defaults to the LUDAO_DOWNLOAD_DIR setting, then ./downloads under the server process's working directory. A relative path resolves against that working directory; the resolved output file always stays inside this directory.",
      },
    },
    required: ["resource_id"],
  },
};

export const libraryTools: ToolDefinition[] = [
  ludaoSearchTool,
  ludaoResourceTool,
  ludaoDownloadTool,
];

export const libraryHandlers: Record<string, ToolHandler> = {
  ludao_search: handleSearch,
  ludao_resource: handleResource,
  ludao_download: handleDownload,
};
