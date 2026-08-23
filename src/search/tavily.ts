/**
 * Search Layer — Tavily engine.
 *
 * Exposes two tools:
 *  - `search`  : query the open web, return ranked results (Tavily /search)
 *  - `extract` : read cleaned content from known URLs (Tavily /extract)
 *
 * Talks to the Tavily REST API directly over axios. Runs keyless when
 * TAVILY_API_KEY is absent (search/extract remain available, rate-limited).
 */
import axios, { AxiosInstance } from "axios";
import {
  SEARCH_KEYLESS,
  SESSION_ID,
  TAVILY_API_KEY,
  TAVILY_HUMAN_ID,
} from "../config.js";
import {
  cleanParams,
  textResult,
  truncate,
  type ToolDefinition,
  type ToolHandler,
  type ToolResult,
} from "../types.js";

const ENDPOINTS = {
  search: "https://api.tavily.com/search",
  extract: "https://api.tavily.com/extract",
} as const;

const DOCS = {
  search: "https://docs.tavily.com/documentation/api-reference/endpoint/search",
  extract: "https://docs.tavily.com/documentation/api-reference/endpoint/extract",
} as const;

let axiosInstance: AxiosInstance | null = null;

function client(): AxiosInstance {
  if (axiosInstance) return axiosInstance;
  axiosInstance = axios.create({
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(SEARCH_KEYLESS
        ? {
            "X-Tavily-Access-Mode": "keyless",
            "X-Client-Source": "general-search-mcp-keyless",
          }
        : {
            Authorization: `Bearer ${TAVILY_API_KEY}`,
            "X-Client-Source": "general-search-mcp",
          }),
      "X-Session-Id": SESSION_ID,
      ...(TAVILY_HUMAN_ID ? { "X-Human-Id": TAVILY_HUMAN_ID } : {}),
    },
  });
  return axiosInstance;
}

/** Attach the api_key field only when running keyed. */
function withKey(body: Record<string, unknown>): Record<string, unknown> {
  return SEARCH_KEYLESS ? body : { ...body, api_key: TAVILY_API_KEY };
}

function tavilyError(where: keyof typeof DOCS, error: unknown): ToolResult {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { detail?: unknown; message?: unknown }
      | undefined;
    const detail =
      data && typeof data === "object"
        ? (data.detail ?? data.message ?? data)
        : error.message;
    const detailStr =
      typeof detail === "object" ? JSON.stringify(detail) : String(detail);
    return textResult(
      `Tavily ${where} error: ${detailStr}\nDocumentation: ${DOCS[where]}`,
      true,
    );
  }
  return textResult(
    `Tavily ${where} error: ${(error as Error).message}`,
    true,
  );
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const searchTool: ToolDefinition = {
  name: "search",
  description:
    "Search the web for current information on any topic (Tavily engine). Use for news, facts, or data beyond your knowledge cutoff. Returns ranked results with titles, URLs, and content snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      search_depth: {
        type: "string",
        enum: ["basic", "advanced", "fast", "ultra-fast"],
        description:
          "Depth of the search. 'basic' for generic results, 'advanced' for thorough search, 'fast'/'ultra-fast' to prioritise latency.",
        default: "basic",
      },
      topic: {
        type: "string",
        enum: ["general", "news"],
        description: "Category of the search.",
        default: "general",
      },
      time_range: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "Time range back from the current date to include.",
      },
      start_date: {
        type: "string",
        description: "Return results after this date, format YYYY-MM-DD.",
      },
      end_date: {
        type: "string",
        description: "Return results before this date, format YYYY-MM-DD.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of search results to return.",
        default: 5,
        minimum: 1,
        maximum: 20,
      },
      include_images: {
        type: "boolean",
        description: "Include a list of query-related images.",
        default: false,
      },
      include_image_descriptions: {
        type: "boolean",
        description: "Include query-related images with their descriptions.",
        default: false,
      },
      include_raw_content: {
        type: "boolean",
        description: "Include cleaned, parsed HTML content of each result.",
        default: false,
      },
      include_domains: {
        type: "array",
        items: { type: "string" },
        description: "Domains to specifically include in results.",
        default: [],
      },
      exclude_domains: {
        type: "array",
        items: { type: "string" },
        description: "Domains to specifically exclude from results.",
        default: [],
      },
      country: {
        type: "string",
        description:
          "Boost results from a specific country (full country name, e.g. 'Japan'). Only when topic is general.",
      },
      include_favicon: {
        type: "boolean",
        description: "Include the favicon URL for each result.",
        default: false,
      },
    },
    required: ["query"],
  },
};

const extractTool: ToolDefinition = {
  name: "extract",
  description:
    "Extract cleaned content from one or more known URLs (Tavily engine). Returns page content in markdown or plain text.",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of URLs to extract content from.",
      },
      extract_depth: {
        type: "string",
        enum: ["basic", "advanced"],
        description:
          "Use 'advanced' for protected sites, tables, or embedded content.",
        default: "basic",
      },
      format: {
        type: "string",
        enum: ["markdown", "text"],
        description: "Output format.",
        default: "markdown",
      },
      include_images: {
        type: "boolean",
        description: "Include images from the pages.",
        default: false,
      },
      include_favicon: {
        type: "boolean",
        description: "Include favicon URLs.",
        default: false,
      },
      query: {
        type: "string",
        description: "Query used to rerank content chunks by relevance.",
      },
    },
    required: ["urls"],
  },
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

interface SearchResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  favicon?: string;
}

function formatSearch(data: {
  answer?: string;
  results?: SearchResult[];
  images?: Array<string | { url?: string; description?: string }>;
}): string {
  const out: string[] = [];
  if (data.answer) out.push(`Answer: ${data.answer}\n`);
  out.push("Results:");
  for (const [i, r] of (data.results ?? []).entries()) {
    out.push(`\n[${i + 1}] ${r.title ?? "(untitled)"}`);
    if (r.url) out.push(`URL: ${r.url}`);
    if (r.content) out.push(`Content: ${r.content}`);
    if (r.raw_content) out.push(`Raw: ${truncate(r.raw_content, 4000)}`);
    if (r.favicon) out.push(`Favicon: ${r.favicon}`);
  }
  if (data.images && data.images.length > 0) {
    out.push("\nImages:");
    for (const [i, img] of data.images.entries()) {
      if (typeof img === "string") out.push(`[${i + 1}] ${img}`);
      else {
        out.push(`[${i + 1}] ${img.url ?? ""}`);
        if (img.description) out.push(`    ${img.description}`);
      }
    }
  }
  return out.join("\n");
}

function formatExtract(data: {
  results?: Array<{ url?: string; raw_content?: string; content?: string }>;
  failed_results?: Array<{ url?: string; error?: string }>;
}): string {
  const out: string[] = ["Extracted content:"];
  for (const [i, r] of (data.results ?? []).entries()) {
    out.push(`\n[${i + 1}] ${r.url ?? ""}`);
    const body = r.raw_content ?? r.content ?? "";
    if (body) out.push(truncate(body, 12000));
  }
  if (data.failed_results && data.failed_results.length > 0) {
    out.push("\nFailed URLs:");
    for (const f of data.failed_results) {
      out.push(`- ${f.url ?? ""}${f.error ? `: ${f.error}` : ""}`);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handleSearch: ToolHandler = async (args) => {
  try {
    const body = cleanParams(
      withKey({
        query: args.query,
        search_depth: args.search_depth,
        topic: args.country ? "general" : args.topic,
        time_range: args.time_range,
        start_date: args.start_date,
        end_date: args.end_date,
        max_results: args.max_results,
        include_images: args.include_images,
        include_image_descriptions: args.include_image_descriptions,
        include_raw_content: args.include_raw_content,
        include_domains: args.include_domains,
        exclude_domains: args.exclude_domains,
        country: args.country,
        include_favicon: args.include_favicon,
      }),
    );
    // Tavily rejects time_range together with an explicit date window.
    if ((body.start_date || body.end_date) && body.time_range) {
      delete body.time_range;
    }
    const res = await client().post(ENDPOINTS.search, body);
    return textResult(formatSearch(res.data));
  } catch (error) {
    return tavilyError("search", error);
  }
};

const handleExtract: ToolHandler = async (args) => {
  try {
    const body = cleanParams(
      withKey({
        urls: args.urls,
        extract_depth: args.extract_depth,
        format: args.format,
        include_images: args.include_images,
        include_favicon: args.include_favicon,
        query: args.query,
      }),
    );
    const res = await client().post(ENDPOINTS.extract, body);
    return textResult(formatExtract(res.data));
  } catch (error) {
    return tavilyError("extract", error);
  }
};

export const searchTools: ToolDefinition[] = [searchTool, extractTool];

export const searchHandlers: Record<string, ToolHandler> = {
  search: handleSearch,
  extract: handleExtract,
};