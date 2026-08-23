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

export const SERVER_NAME = "general-search-mcp";
export const SERVER_VERSION = "0.1.0";

// Search layer (Tavily)
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY?.trim() ?? "";
export const TAVILY_HUMAN_ID = process.env.TAVILY_HUMAN_ID?.trim() ?? "";

// Crawl layer (Firecrawl)
export const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY?.trim() ?? "";
export const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL?.trim() ?? "";

/** A layer runs keyless when it has no credential of its own. */
export const SEARCH_KEYLESS = TAVILY_API_KEY === "";
export const CRAWL_KEYLESS = FIRECRAWL_API_KEY === "" && FIRECRAWL_API_URL === "";

/** Stable per-process id forwarded to Tavily for session-level analytics. */
export const SESSION_ID = randomUUID();