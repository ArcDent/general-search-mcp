#!/usr/bin/env node
/**
 * gsearch entry point.
 *
 * Registers the Search Layer (Tavily) and Crawl Layer (Firecrawl) tools on a
 * single MCP server and serves them over stdio. Run with `--list-tools` to
 * print the exposed tools and exit.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CallToolResult,
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CRAWL_KEYLESS,
  SEARCH_KEYLESS,
  SERVER_NAME,
  SERVER_VERSION,
} from "./config.js";
import { crawlHandlers, crawlTools } from "./crawl/firecrawl.js";
import { searchHandlers, searchTools } from "./search/tavily.js";
import type { ToolDefinition, ToolHandler } from "./types.js";

const tools: ToolDefinition[] = [...searchTools, ...crawlTools];
const handlers: Record<string, ToolHandler> = {
  ...searchHandlers,
  ...crawlHandlers,
};

if (process.argv.includes("--list-tools")) {
  console.log(`${SERVER_NAME} v${SERVER_VERSION} — available tools:`);
  for (const tool of tools) {
    console.log(`\n- ${tool.name}\n  ${tool.description}`);
  }
  process.exit(0);
}

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(
  CallToolRequestSchema,
  async (request): Promise<CallToolResult> => {
    const handler = handlers[request.params.name];
    if (!handler) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`,
      );
    }
    return handler(request.params.arguments ?? {}) as Promise<CallToolResult>;
  },
);

server.onerror = (error) => {
  console.error(`[${SERVER_NAME}] MCP error:`, error);
};

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[${SERVER_NAME}] running on stdio — search layer: ${
      SEARCH_KEYLESS ? "keyless" : "keyed"
    }, crawl layer: ${CRAWL_KEYLESS ? "keyless" : "keyed"}`,
  );
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal:`, error);
  process.exit(1);
});