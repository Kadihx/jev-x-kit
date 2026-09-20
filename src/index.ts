#!/usr/bin/env node
/**
 * jev-super-agent-mcp — stdio MCP server entry point.
 *
 * Works with Claude Code, Cursor, Codex, OpenCode, Continue.dev, or any MCP
 * client. Diagnostics go to stderr; stdout is reserved for JSON-RPC.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./core/config.js";
import { errorMessage } from "./core/errors.js";
import { log, setLogLevel } from "./core/log.js";
import { buildTools, createContext, type ToolSpec } from "./tools/registry.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const context = await createContext(config);
  const tools: ToolSpec[] = buildTools(context);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    { name: "jev-super-agent-mcp", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, title, description, inputSchema }) => ({
      name,
      title,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: `unknown tool: ${request.params.name}`, available: [...byName.keys()] },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = errorMessage(error);
      log.warn(`tool ${tool.name} failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ tool: tool.name, error: message }, null, 2) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(`jev-super-agent-mcp v${VERSION} ready: ${tools.length} tools, backend=${context.resolved.backend.meta.id}`);
}

main().catch((error) => {
  process.stderr.write(`[jev:error] fatal: ${errorMessage(error)}\n`);
  process.exit(1);
});
