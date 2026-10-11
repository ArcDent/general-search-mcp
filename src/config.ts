/**
 * Centralised configuration. Environment is loaded once here; every other
 * module imports the resolved values from this file.
 *
 * Credentials never leave this module as literals — downstream code reads the
 * exported constants, and each layer decides keyed vs keyless independently.
 */
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

export const SERVER_NAME = "gsearch";
export const SERVER_VERSION = "0.1.0";

// Search layer (Tavily)
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY?.trim() ?? "";
export const TAVILY_HUMAN_ID = process.env.TAVILY_HUMAN_ID?.trim() ?? "";

// Crawl layer (Firecrawl)
export const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY?.trim() ?? "";
export const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL?.trim() ?? "";

// Library layer (Ludao). Opt-in: only true/1/yes/on (any case) turn it on;
// unset, empty, or any other value keeps the layer off.
export const LUDAO_ENABLED = ["true", "1", "yes", "on"].includes(
  process.env.LUDAO_ENABLED?.trim().toLowerCase() ?? "",
);
// Optional credential; empty means guest access to public materials.
export const LUDAO_TOKEN = process.env.LUDAO_TOKEN?.trim() ?? "";
// Empty override falls back to the default Ludao site.
export const LUDAO_BASE_URL =
  process.env.LUDAO_BASE_URL?.trim() || "https://xmu.vintces.icu/api";
// Empty override falls back to ./downloads under the process working directory.
export const LUDAO_DOWNLOAD_DIR = process.env.LUDAO_DOWNLOAD_DIR?.trim() || "./downloads";

/** A layer runs keyless when it has no credential of its own. */
export const SEARCH_KEYLESS = TAVILY_API_KEY === "";
export const CRAWL_KEYLESS = FIRECRAWL_API_KEY === "" && FIRECRAWL_API_URL === "";

/** Stable per-process id forwarded to Tavily for session-level analytics. */
export const SESSION_ID = randomUUID();