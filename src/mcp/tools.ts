import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDoc, saveDoc } from '../doc/io.js';
import { collectIds } from '../doc/id.js';
import { validateDoc } from '../doc/validate.js';
import { query as q, get as g, update as u, insert as i, remove as rm, move as mv, batch as bt, type BatchOp } from '../ops/index.js';
import { renderDocument } from '../render/index.js';
import { screenshotPen, findBrowser } from '../shot/screenshot.js';
import { isDaemonRunning, sendRequest } from '../web/client.js';

/**
 * 工具层：MCP 与 CLI 共享同一套 handler（无状态）。
 * 读工具：load → 返回。写工具：load → 操作 → 校验（错误不落盘）→ 原子保存（mtime 防覆盖）。
 * 命名 paintress_*（偏离 technical-plan 的 ptr_* 简写，与产品名一致）。
 */

/** 工具输出：JSON 对象或数组（MCP 序列化为文本，CLI 直接打印） */
export type ToolOutput = Record<string, unknown> | unknown[];

export interface ToolDef {
  description: string;
  inputSchema: z.ZodRawShape;
  run(args: Record<string, unknown>): ToolOutput | Promise<ToolOutput>;
}

function reqStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v === '') throw new Error(`缺少必填参数：${key}`);
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === 'boolean' ? v : undefined;
}

function objArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = args[key];
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`参数 ${key} 必须是对象`);
  return v as Record<string, unknown>;
}

/** 读：load 后执行，直接返回负载 */
function read<T>(path: string, fn: (ctx: ReturnType<typeof loadDoc>) => T): T {
  const loaded = loadDoc(path);
  return fn(loaded);
}

/**
 * 把「本次写操作动到的节点 id」告知 daemon，供前端做变更高亮。
 * 先转绝对路径：daemon 的 cwd 未必与调用方一致，不能让 daemon 替我们 resolve 相对路径。
 * 非阻塞发送（写路径性能语义不变）；socket 默认有 ref，进程不会在响应前提前退出。
 */
function notifyChanges(path: string, ids: string[]): void {
  if (ids.length === 0 || !isDaemonRunning()) return;
  void sendRequest({ kind: 'changes', path: resolve(path), ids }, 2000).catch(() => {
    /* 高亮是尽力而为，失败不影响写入结果 */
  });
}

/**
 * 写：load → 变更 → 校验（结构错误不落盘）→ 原子保存（保持原风味）。
 * fn 可通过 mark() 登记受影响的节点 id，写成功后统一通知 daemon。
 */
async function write(
  path: string,
  fn: (doc: ReturnType<typeof loadDoc>['doc'], mark: (ids: string[]) => void) => unknown,
): Promise<{ ok: true; result: unknown; warnings: unknown[] }> {
  const loaded = loadDoc(path);
  const touched: string[] = [];
  const mark = (ids: string[]): void => {
    touched.push(...ids);
  };
  const result = fn(loaded.doc, mark);
  const v = validateDoc(loaded.doc);
  if (!v.ok) {
    throw new Error(`变更后结构校验失败，未落盘：\n${v.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  }
  saveDoc(path, loaded.doc, { expectedMtimeMs: loaded.mtimeMs, flavor: loaded.flavor });
  notifyChanges(path, touched);
  return { ok: true, result, warnings: v.warnings };
}

function countByType(children: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const rec = n as Record<string, unknown>;
      const t = typeof rec['type'] === 'string' ? rec['type'] : '?';
      counts[t] = (counts[t] ?? 0) + 1;
      const kids = rec['children'];
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(children);
  return counts;
}

export const TOOLS: Record<string, ToolDef> = {
  paintress_doc_info: {
    description: '文档摘要：版本、格式风味、节点统计、变量表、顶层节点',
    inputSchema: { path: z.string().describe('设计稿路径') },
    run: (a) =>
      read(reqStr(a, 'path'), (ctx) => ({
        flavor: ctx.flavor,
        version: ctx.doc.version,
        fileToken: ctx.doc.fileToken,
        variables: ctx.doc.variables ? Object.keys(ctx.doc.variables) : [],
        topLevel: ctx.doc.children.map((c) => ({ id: (c as Record<string, unknown>)['id'], name: (c as Record<string, unknown>)['name'], type: (c as Record<string, unknown>)['type'] })),
        nodeCount: Object.values(countByType(ctx.doc.children)).reduce((s, n) => s + n, 0),
        byType: countByType(ctx.doc.children),
        warnings: ctx.validation.warnings,
      })),
  },

  paintress_query: {
    description: '条件查询节点：type / name（精确或正则）/ id / reusable',
    inputSchema: {
      path: z.string(),
      type: z.string().optional(),
      name: z.string().optional(),
      nameRegex: z.boolean().optional().describe('name 按正则解释'),
      id: z.string().optional(),
      reusable: z.boolean().optional(),
    },
    run: (a) =>
      read(reqStr(a, 'path'), (ctx) =>
        q(ctx.doc, {
          type: optStr(a, 'type'),
          name: optStr(a, 'name'),
          nameRegex: optBool(a, 'nameRegex'),
          id: optStr(a, 'id'),
          reusable: optBool(a, 'reusable'),
        }),
      ),
  },

  paintress_get: {
    description: '取单个节点子树；depth 控制深度（0=仅本节点，children 省略为 …）',
    inputSchema: { path: z.string(), id: z.string(), depth: z.number().int().min(0).optional() },
    run: (a) =>
      read(reqStr(a, 'path'), (ctx) => {
        const res = g(ctx.doc, reqStr(a, 'id'), optNum(a, 'depth') ?? Infinity);
        if (!res) throw new Error(`节点不存在：${reqStr(a, 'id')}`);
        return res;
      }),
  },

  paintress_update: {
    description: '浅合并更新节点属性（id 与 type 不可改）',
    inputSchema: { path: z.string(), id: z.string(), patch: z.record(z.unknown()) },
    run: (a) =>
      write(reqStr(a, 'path'), (doc, mark) => {
        const id = reqStr(a, 'id');
        const res = u(doc, id, objArg(a, 'patch'));
        mark([id]);
        return res;
      }),
  },

  paintress_insert: {
    description: '插入子节点（缺 id 自动生成；返回新 id）',
    inputSchema: {
      path: z.string(),
      parent: z.string().describe("父节点 id，或 'root'"),
      node: z.record(z.unknown()),
      index: z.number().int().min(0).optional(),
    },
    run: (a) =>
      write(reqStr(a, 'path'), (doc, mark) => {
        const newId = i(doc, reqStr(a, 'parent'), objArg(a, 'node'), optNum(a, 'index'));
        mark([newId]);
        return newId;
      }),
  },

  paintress_delete: {
    description: '删除节点（含子树）',
    inputSchema: { path: z.string(), id: z.string() },
    run: (a) =>
      write(reqStr(a, 'path'), (doc, mark) => {
        const id = reqStr(a, 'id');
        const node = rm(doc, id) as Record<string, unknown>;
        mark([id]);
        return { deleted: { id: node['id'], name: node['name'], type: node['type'] } };
      }),
  },

  paintress_move: {
    description: '移动/重排节点到新父（防环校验）',
    inputSchema: { path: z.string(), id: z.string(), parent: z.string(), index: z.number().int().min(0).optional() },
    run: (a) =>
      write(reqStr(a, 'path'), (doc, mark) => {
        const id = reqStr(a, 'id');
        mv(doc, id, reqStr(a, 'parent'), optNum(a, 'index'));
        mark([id]);
        return { moved: id, to: reqStr(a, 'parent') };
      }),
  },

  paintress_batch: {
    description: '批量原子操作：update/insert/delete/move 数组，任一步失败整体作废',
    inputSchema: { path: z.string(), ops: z.array(z.record(z.unknown())) },
    run: (a) =>
      write(reqStr(a, 'path'), (doc, mark) => {
        const raw = a['ops'];
        if (!Array.isArray(raw)) throw new Error('ops 必须是数组');
        const ops = raw.map((op, idx) => {
          const rec = op as Record<string, unknown>;
          const kind = rec['op'];
          if (kind === 'update') return { op: 'update', id: String(rec['id']), patch: (rec['patch'] ?? {}) as Record<string, unknown> } as BatchOp;
          if (kind === 'insert') return { op: 'insert', parent: String(rec['parent']), node: rec['node'], index: typeof rec['index'] === 'number' ? rec['index'] : undefined } as BatchOp;
          if (kind === 'delete') return { op: 'delete', id: String(rec['id']) } as BatchOp;
          if (kind === 'move') return { op: 'move', id: String(rec['id']), parent: String(rec['parent']), index: typeof rec['index'] === 'number' ? rec['index'] : undefined } as BatchOp;
          throw new Error(`ops[${idx}] 的 op 必须是 update|insert|delete|move`);
        });
        // batch 是克隆语义（返回新文档），但四类 op 只改 children 树；回填后走统一的写路径
        const before = new Set(collectIds(doc.children));
        const out = bt(doc, ops);
        doc.children = out.children;
        // 显式操作的 id + 本次真正新增的节点 id（insert 由 ops 层生成，只能事后对比）
        const insertedIds = collectIds(doc.children).filter((id) => !before.has(id));
        mark([...ops.flatMap((op) => (op.op === 'insert' ? [] : [op.id])), ...insertedIds]);
        return { applied: ops.length, inserted: insertedIds.length };
      }),
  },

  paintress_validate: {
    description: '校验文档：结构错误 + 语义警告（重复 id、悬空 ref、未知类型、未定义变量）',
    inputSchema: { path: z.string() },
    run: (a) => read(reqStr(a, 'path'), (ctx) => ctx.validation),
  },

  paintress_render: {
    description: '渲染设计稿为 HTML 文件（每节点带 data-node-id）；返回输出路径与画布尺寸',
    inputSchema: {
      path: z.string(),
      out: z.string().describe('输出 .html 路径'),
    },
    run: (a) => {
      const out = reqStr(a, 'out');
      const loaded = loadDoc(reqStr(a, 'path'));
      const r = renderDocument(loaded.doc);
      writeFileSync(out, r.html, 'utf8');
      return { ok: true, out, canvas: r.canvas, warnings: r.warnings };
    },
  },

  paintress_screenshot: {
    description: '渲染并截图为 PNG（默认 2x）；需要本机 Chromium/Chrome 或 PTR_BROWSER 指向的可执行文件',
    inputSchema: {
      path: z.string(),
      out: z.string().describe('输出 .png 路径'),
      scale: z.number().int().min(1).max(4).optional().describe('像素倍率，默认 2'),
    },
    run: async (a) => {
      const browser = findBrowser();
      if (!browser) throw new Error('未找到可用浏览器：安装 Chromium/Chrome，或设置 PTR_BROWSER');
      const res = await screenshotPen(reqStr(a, 'path'), reqStr(a, 'out'), {
        ...(typeof a['scale'] === 'number' ? { scale: a['scale'] as number } : {}),
      });
      return { ok: true, out: res.out, canvas: res.canvas, browser: res.browser, warnings: res.warnings };
    },
  },

  paintress_marks: {
    description:
      '读取/清空当前会话的节点标记：用户在浏览器里点击的节点会分配短号 #1 #2…，返回短号 → 节点 id 映射，便于对话中指代（如“#1 改成蓝色”）',
    inputSchema: {
      project: z.string().optional().describe('项目名；缺省返回全部项目的标记'),
      action: z.enum(['list', 'clear']).optional().describe('默认 list'),
    },
    run: async (a) => {
      if (!isDaemonRunning()) {
        throw new Error('paintress web 未运行，无法读取标记；先运行 paintress web --daemon');
      }
      const project = optStr(a, 'project') ?? '';
      const action = optStr(a, 'action') ?? 'list';
      if (action === 'clear') {
        const res = await sendRequest({ kind: 'clear-marks', project });
        return res;
      }
      const res = await sendRequest({ kind: 'marks', project });
      return res;
    },
  },
};
