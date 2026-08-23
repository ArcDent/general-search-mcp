/**
 * Crawl Layer — Firecrawl engine.
 *
 * Exposes three tools:
 *  - `scrape` : fetch one known page as markdown/structured data
 *  - `crawl`  : traverse a site from a root URL, polling to a terminal state
 *  - `map`    : enumerate discoverable URLs under a site (no page bodies)
 *
 * Uses the official Firecrawl JS SDK (@mendable/firecrawl-js). The SDK resolves
 * FIRECRAWL_API_KEY / FIRECRAWL_API_URL from the environment; we pass them
 * explicitly so credential handling stays in one place.
 */
import { Firecrawl } from "@mendable/firecrawl-js";
import {
  CRAWL_KEYLESS,
  FIRECRAWL_API_KEY,
  FIRECRAWL_API_URL,
} from "../config.js";
import {
  cleanParams,
  textResult,
  truncate,
  type ToolDefinition,
  type ToolHandler,
  type ToolResult,
} from "../types.js";

let firecrawl: Firecrawl | null = null;

function client(): Firecrawl {
  if (firecrawl) return firecrawl;
  const options: { apiKey?: string; apiUrl?: string } = {};
  if (FIRECRAWL_API_KEY) options.apiKey = FIRECRAWL_API_KEY;
  if (FIRECRAWL_API_URL) options.apiUrl = FIRECRAWL_API_URL;
  firecrawl = new Firecrawl(options);
  return firecrawl;
}

function firecrawlError(where: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const hint = CRAWL_KEYLESS
    ? "\nHint: the crawl layer is running keyless. Set FIRECRAWL_API_KEY (get one free at https://firecrawl.dev) or FIRECRAWL_API_URL for a self-hosted instance."
    : "";
  return textResult(`Firecrawl ${where} error: ${message}${hint}`, true);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const scrapeTool: ToolDefinition = {
  name: "scrape",
  description:
    "Scrape a single known URL into clean content (Firecrawl engine). Use when you already know the exact page. Returns markdown by default; request other formats as needed.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to scrape." },
      formats: {
        type: "array",
        items: { type: "string" },
        description:
          'Output formats, e.g. ["markdown"], ["html"], ["links"], ["rawHtml"], ["screenshot"].',
        default: ["markdown"],
      },
      onlyMainContent: {
        type: "boolean",
        description: "Return only the main content, stripping nav/footers.",
        default: true,
      },
      includeTags: {
        type: "array",
        items: { type: "string" },
        description: "HTML tags/selectors to include.",
      },
      excludeTags: {
        type: "array",
        items: { type: "string" },
        description: "HTML tags/selectors to exclude.",
      },
      waitFor: {
        type: "number",
        description: "Milliseconds to wait for dynamic content before scraping.",
      },
      timeout: { type: "number", description: "Request timeout in milliseconds." },
      mobile: {
        type: "boolean",
        description: "Emulate a mobile device.",
        default: false,
      },
      maxAge: {
        type: "number",
        description: "Max cache age in ms; serve a cached copy if fresher.",
      },
    },
    required: ["url"],
  },
};

const crawlTool: ToolDefinition = {
  name: "crawl",
  description:
    "Crawl a website from a root URL and collect content across pages (Firecrawl engine). Starts the job and polls until it finishes. Keep limits low to avoid oversized output.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The root URL to crawl." },
      limit: {
        type: "integer",
        description: "Maximum number of pages to crawl.",
        default: 20,
        minimum: 1,
      },
      maxDiscoveryDepth: {
        type: "integer",
        description: "Maximum link depth to discover from the root.",
        minimum: 1,
      },
      sitemap: {
        type: "string",
        enum: ["include", "skip", "only"],
        description: "How to use the site's sitemap during discovery.",
      },
      includePaths: {
        type: "array",
        items: { type: "string" },
        description: "Regex path patterns to include (e.g. /docs/.*).",
      },
      excludePaths: {
        type: "array",
        items: { type: "string" },
        description: "Regex path patterns to exclude.",
      },
      allowExternalLinks: {
        type: "boolean",
        description: "Follow links to external domains.",
        default: false,
      },
      crawlEntireDomain: {
        type: "boolean",
        description: "Crawl the whole domain rather than just the subtree.",
        default: false,
      },
      scrapeOptions: {
        type: "object",
        description:
          'Per-page scrape options, e.g. {"formats":["markdown"],"onlyMainContent":true}.',
      },
      pollInterval: {
        type: "integer",
        description: "Seconds between status polls while waiting.",
        default: 2,
        minimum: 1,
      },
      timeout: {
        type: "integer",
        description: "Overall wait timeout in seconds before giving up.",
      },
    },
    required: ["url"],
  },
};

const mapTool: ToolDefinition = {
  name: "map",
  description:
    "Discover the URLs available on a site without fetching page bodies (Firecrawl engine). Use to inventory a site before scraping. Returns a list of URLs.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The root URL to map." },
      search: {
        type: "string",
        description: "Filter discovered URLs by a search term.",
      },
      sitemap: {
        type: "string",
        enum: ["include", "skip", "only"],
        description: "How to use the site's sitemap during discovery.",
      },
      includeSubdomains: {
        type: "boolean",
        description: "Include URLs from subdomains.",
        default: false,
      },
      limit: {
        type: "number",
        description: "Maximum number of URLs to return.",
      },
      ignoreQueryParameters: {
        type: "boolean",
        description: "Treat URLs that differ only by query string as one.",
      },
    },
    required: ["url"],
  },
};

// ---------------------------------------------------------------------------
// Formatters — defensive against the SDK's rich, evolving response shapes.
// ---------------------------------------------------------------------------

const MAX_CRAWL_PAGES = 40;
const MAX_PAGE_CHARS = 1500;
const MAX_MAP_URLS = 300;

interface FcDocument {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  metadata?: { title?: string; sourceURL?: string; url?: string };
}

function pageUrl(doc: FcDocument): string {
  return doc.metadata?.sourceURL ?? doc.metadata?.url ?? "";
}

function pageBody(doc: FcDocument): string {
  if (doc.markdown) return doc.markdown;
  if (doc.json !== undefined) return JSON.stringify(doc.json, null, 2);
  if (doc.html) return doc.html;
  if (doc.links && doc.links.length > 0) return doc.links.join("\n");
  return "";
}

function formatScrape(doc: FcDocument): string {
  const out: string[] = [];
  if (doc.metadata?.title) out.push(`Title: ${doc.metadata.title}`);
  const url = pageUrl(doc);
  if (url) out.push(`URL: ${url}`);
  const body = pageBody(doc);
  out.push("", body ? truncate(body, 20000) : "(no content returned)");
  return out.join("\n");
}

function formatCrawl(job: {
  status?: string;
  completed?: number;
  total?: number;
  creditsUsed?: number;
  data?: FcDocument[];
}): string {
  const out: string[] = [
    `Crawl status: ${job.status ?? "unknown"}`,
    `Pages: ${job.completed ?? 0}/${job.total ?? 0}`,
  ];
  if (job.creditsUsed != null) out.push(`Credits used: ${job.creditsUsed}`);
  const docs = job.data ?? [];
  out.push(`\nCollected ${docs.length} page(s):`);
  for (const [i, doc] of docs.slice(0, MAX_CRAWL_PAGES).entries()) {
    out.push(`\n[${i + 1}] ${pageUrl(doc)}`);
    if (doc.metadata?.title) out.push(`Title: ${doc.metadata.title}`);
    const body = pageBody(doc);
    if (body) out.push(truncate(body, MAX_PAGE_CHARS));
  }
  if (docs.length > MAX_CRAWL_PAGES) {
    out.push(`\n… and ${docs.length - MAX_CRAWL_PAGES} more page(s) not shown.`);
  }
  return out.join("\n");
}

function formatMap(data: {
  links?: Array<string | { url?: string; title?: string }>;
}): string {
  const links = data.links ?? [];
  const out: string[] = [`Discovered ${links.length} URL(s):`];
  for (const link of links.slice(0, MAX_MAP_URLS)) {
    if (typeof link === "string") out.push(link);
    else out.push(`${link.url ?? ""}${link.title ? ` — ${link.title}` : ""}`);
  }
  if (links.length > MAX_MAP_URLS) {
    out.push(`… and ${links.length - MAX_MAP_URLS} more not shown.`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handleScrape: ToolHandler = async (args) => {
  try {
    const { url, ...rest } = args;
    const options = cleanParams(rest);
    // Cast at the SDK boundary: options are validated by Firecrawl server-side.
    const doc = await client().scrape(String(url), options as never);
    return textResult(formatScrape(doc as FcDocument));
  } catch (error) {
    return firecrawlError("scrape", error);
  }
};

const handleCrawl: ToolHandler = async (args) => {
  try {
    const { url, ...rest } = args;
    const options = cleanParams(rest);
    const job = await client().crawl(String(url), options as never);
    return textResult(formatCrawl(job as never));
  } catch (error) {
    return firecrawlError("crawl", error);
  }
};

const handleMap: ToolHandler = async (args) => {
  try {
    const { url, ...rest } = args;
    const options = cleanParams(rest);
    const data = await client().map(String(url), options as never);
    return textResult(formatMap(data as never));
  } catch (error) {
    return firecrawlError("map", error);
  }
};

export const crawlTools: ToolDefinition[] = [scrapeTool, crawlTool, mapTool];

export const crawlHandlers: Record<string, ToolHandler> = {
  scrape: handleScrape,
  crawl: handleCrawl,
  map: handleMap,
};