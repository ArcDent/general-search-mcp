/**
 * Shared tool contracts used by both the search layer and the crawl layer.
 * Tool definitions use JSON Schema (the shape the MCP SDK sends to clients);
 * handlers receive raw arguments and return a text tool result.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolModule {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

/** Wrap plain text into a tool result. */
export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Drop empty values so upstream APIs receive only meaningful fields.
 * Removes empty strings, null, undefined, and empty arrays.
 */
export function cleanParams(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** Truncate long text for readable, context-friendly tool output. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}