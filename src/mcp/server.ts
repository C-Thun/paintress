import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from '../shared/version.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';
import { autoRegister, type AutoRegisterResult } from '../web/autoregister.js';

const SERVER_NAME = 'paintress';
const SERVER_VERSION = VERSION;

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

/**
 * 父进程看门狗：stdio MCP server 必须随宿主死亡而退出，否则变成孤儿进程
 * （MCP 生态的已知问题）。两道保险：ppid 变化 + stdin EOF。
 */
function installParentWatchdog(): void {
  const parentPid = process.ppid;
  const timer = setInterval(() => {
    if (process.ppid !== parentPid) {
      exitClean(0);
    }
    try {
      process.kill(parentPid, 0);
    } catch {
      exitClean(0);
    }
  }, 5000);
  timer.unref();
  // stdin 关闭通常也意味着宿主已退出；不消费数据，只监听结束
  process.stdin.on('end', () => exitClean(0));
  process.stdin.on('close', () => exitClean(0));
}

/**
 * attach 连接引用：必须持有，否则 GC 关闭后 daemon 会误判 agent 已退出。
 * 退出时显式关闭——比等 OS 回收更快让 daemon 看到 we're gone。
 */
let registrar: AutoRegisterResult | null = null;

/** 干净退出：断开 attach 连接后退出 */
function exitClean(code = 0): never {
  try {
    registrar?.handle.close();
  } catch {
    /* 连接已断，忽略 */
  }
  process.exit(code);
}

/** 自动注册自身（best-effort，失败不阻断 MCP） */
async function registerSelf(): Promise<void> {
  const res = await autoRegister();
  registrar = res;
  if (res) {
    process.stderr.write(`paintress: 已注册项目 "${res.project}"，浏览器打开 http://localhost:3316/${encodeURIComponent(res.project)}\n`);
  }
}

/** CLI `paintress mcp` 入口：stdio transport + 自动注册 */
export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  installParentWatchdog();
  void registerSelf();
}
