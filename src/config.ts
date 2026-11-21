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

/** Split a comma-separated key list: trim each key, drop empties and repeats. */
function parseKeys(raw: string | undefined): string[] {
  const keys = (raw ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  return [...new Set(keys)];
}

// Search layer (Tavily). TAVILY_API_KEY may list several keys, comma-separated.
export const TAVILY_API_KEYS = parseKeys(process.env.TAVILY_API_KEY);
export const TAVILY_HUMAN_ID = process.env.TAVILY_HUMAN_ID?.trim() ?? "";

// Crawl layer (Firecrawl). FIRECRAWL_API_KEY may list several keys, comma-separated.
export const FIRECRAWL_API_KEYS = parseKeys(process.env.FIRECRAWL_API_KEY);
export const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL?.trim() ?? "";

// How a layer with several keys picks one: "sequential" keeps using the first
// usable key, "round-robin" moves to the next key on every call. Shared by both
// layers; an unrecognised value falls back to sequential and is reported at startup.
export type KeyRotation = "sequential" | "round-robin";
const KEY_ROTATION_RAW = process.env.KEY_ROTATION?.trim() ?? "";
export const KEY_ROTATION: KeyRotation =
  KEY_ROTATION_RAW.toLowerCase() === "round-robin" ? "round-robin" : "sequential";
/** The raw KEY_ROTATION value when it was set but not recognised, else "". */
export const KEY_ROTATION_INVALID = ["", "sequential", "round-robin"].includes(
  KEY_ROTATION_RAW.toLowerCase(),
)
  ? ""
  : KEY_ROTATION_RAW;

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
export const SEARCH_KEYLESS = TAVILY_API_KEYS.length === 0;
export const CRAWL_KEYLESS = FIRECRAWL_API_KEYS.length === 0 && FIRECRAWL_API_URL === "";

/** Stable per-process id forwarded to Tavily for session-level analytics. */
export const SESSION_ID = randomUUID();