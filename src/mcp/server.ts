import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';

const SERVER_NAME = 'paintress';
const SERVER_VERSION = '0.1.0';

/** 构建 MCP server：把共享工具注册到 stdio 协议上 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const [name, def] of Object.entries(TOOLS)) {
    server.registerTool(
      name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args) => {
        try {
          const payload = await def.run(args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
        } catch (cause) {
          return {
            content: [{ type: 'text' as const, text: cause instanceof Error ? cause.message : String(cause) }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}

/** CLI `paintress mcp` 入口：stdio transport */
export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
