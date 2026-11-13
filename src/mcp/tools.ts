import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadDoc, saveDoc, type DocFlavor } from '../doc/io.js';
import { createDoc } from '../doc/create.js';
import { collectIds, genId } from '../doc/id.js';
import { validateDoc } from '../doc/validate.js';
import {
  applyProjectPresets,
  componentsPathFor,
  projectPresetNames,
  findNodeIn,
  isPresetType,
  listComponents,
  listPresets,
  presetPathFor,
  readComponentsFile,
  removePreset,
  setPreset,
  type PresetType,
} from '../doc/project.js';
import { query as q, get as g, update as u, insert as i, remove as rm, move as mv, batch as bt, type BatchOp } from '../ops/index.js';
import { expandRefs, renderDocument } from '../render/index.js';
import { screenshotPen, findBrowser } from '../shot/screenshot.js';
import { isDaemonRunning, sendRequest } from '../web/client.js';
import { ensureViewer } from '../web/autoregister.js';

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
  // 校验看「合并项目预设后」的文档，保存写回未合并的原文档：
  // 否则一次 update 就会把预设值烤进设计稿，人再调预设就不生效了。
  const presetNames = projectPresetNames(path);
  const v = validateDoc(loaded.doc, { knownVars: presetNames, presetVars: presetNames });
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

/**
 * 新建设计稿。path 不带扩展名时补默认扩展名；调用方显式写 `.pen` 时按兼容格式产出
 * （不替用户转换已有文件）。
 */
function newDoc(args: Record<string, unknown>): ToolOutput {
  const raw = reqStr(args, 'path');
  const path = /\.(pen|ptr)$/i.test(raw) ? raw : `${raw}.ptr`;
  const flavor: DocFlavor = path.toLowerCase().endsWith('.pen') ? 'pen' : 'ptr';
  if (existsSync(path) && optBool(args, 'overwrite') !== true) {
    throw new Error(`文件已存在，未覆盖：${path}（确需覆盖传 overwrite=true）`);
  }

  const width = optNum(args, 'width');
  const height = optNum(args, 'height');
  if (width !== undefined && width <= 0) throw new Error(`width 必须大于 0，收到：${width}`);
  if (height !== undefined && height <= 0) throw new Error(`height 必须大于 0，收到：${height}`);

  const layoutArg = optStr(args, 'layout');
  if (layoutArg !== undefined && !['vertical', 'horizontal', 'none'].includes(layoutArg)) {
    throw new Error(`layout 仅支持 vertical / horizontal / none，收到：${layoutArg}`);
  }
  const { doc, boardId } = createDoc({
    name: optStr(args, 'name'),
    width,
    height,
    fill: optStr(args, 'fill'),
    layout: layoutArg === 'vertical' || layoutArg === 'horizontal' || layoutArg === 'none' ? layoutArg : undefined,
    padding: optNum(args, 'padding'),
    gap: optNum(args, 'gap'),
  });

  const check = validateDoc(doc);
  if (!check.ok) {
    throw new Error(`新建文档结构校验失败，未落盘：\n${check.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  }

  // 连带建父目录：允许直接写到还不存在的设计稿目录
  mkdirSync(dirname(path), { recursive: true });
  saveDoc(path, doc, { flavor, createOnly: optBool(args, 'overwrite') !== true });
  const board = doc.children[0] as Record<string, unknown> | undefined;
  return {
    ok: true,
    path,
    flavor,
    version: doc.version,
    boardId,
    canvas: { width: Number(board?.['width'] ?? 0), height: Number(board?.['height'] ?? 0) },
    warnings: check.warnings,
  };
}


/** 复制进设计稿前给整棵子树换新 id：组件库与目标文件的 id 空间互不相干 */
function remapIds(node: unknown, taken: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (typeof rec['id'] === 'string') {
    const fresh = genId(taken);
    taken.add(fresh);
    rec['id'] = fresh;
  }
  const kids = rec['children'];
  if (Array.isArray(kids)) for (const k of kids) remapIds(k, taken);
}

export const TOOLS: Record<string, ToolDef> = {
  paintress_viewer: {
    description:
      '确保本地查看器在运行，并把当前项目注册进去，返回人可以打开的 URL。幂等：已在运行就直接复用（返回现有 pid/端口，绝不起第二个进程），可以在开始画/改/展示设计稿之前无条件调用。**开始作画前先调它，不要等人提醒**',
    inputSchema: {
      dir: z.string().optional().describe('要注册的目录，默认当前工作目录'),
      project: z.string().optional().describe('项目名（URL 里那一段），默认取「父目录/目录名」'),
      depth: z.number().int().min(1).max(6).optional().describe('列举设计稿的最大深度，默认 3'),
    },
    run: async (a) => {
      const dir = optStr(a, 'dir');
      const project = optStr(a, 'project');
      const depth = optNum(a, 'depth');
      const info = await ensureViewer({
        ...(dir !== undefined ? { dir } : {}),
        ...(project !== undefined ? { project } : {}),
        ...(depth !== undefined ? { depth } : {}),
      });
      return {
        ok: true,
        project: info.project,
        url: info.url,
        pid: info.pid,
        port: info.port,
        started: info.startedDaemon,
        openedBrowser: info.openedBrowser,
        hint: `把人指向 ${info.url}（单份设计稿加深链 ?file=<相对路径>）`,
      };
    },
  },

  paintress_new: {
    description:
      '新建一份设计稿：创建一个带空 board 的最小可用文档，可直接 render/screenshot 再逐层 insert；已存在同名文件时报错，除非 overwrite=true。path 不带扩展名时自动补默认扩展名',
    inputSchema: {
      path: z.string().describe('新文档路径；不带扩展名时自动补默认扩展名'),
      name: z.string().optional().describe('board 名称（默认 Board）'),
      width: z.number().positive().optional().describe('board 宽（默认 900）'),
      height: z.number().positive().optional().describe('board 高（默认 600）'),
      fill: z.string().optional().describe('board 背景色（默认 #FFFFFF）'),
      layout: z.enum(['vertical', 'horizontal', 'none']).optional().describe('子节点布局（默认 vertical）'),
      padding: z.number().optional().describe('board 内边距（默认 0）'),
      gap: z.number().optional().describe('主轴向间距（默认 0）'),
      overwrite: z.boolean().optional().describe('已存在时覆盖（默认 false）'),
    },
    run: (a) => newDoc(a),
  },

  paintress_doc_info: {
    description: '文档摘要：版本、格式风味、节点统计、变量表、顶层节点',
    inputSchema: { path: z.string().describe('设计稿路径') },
    run: (a) =>
      read(reqStr(a, 'path'), (ctx) => ({
        flavor: ctx.flavor,
        version: ctx.doc.version,
        fileToken: ctx.doc.fileToken,
        variables: ctx.doc.variables ? Object.keys(ctx.doc.variables) : [],
        projectPresets: (() => {
          const { path: presetPath, items } = listPresets(reqStr(a, 'path'));
          return { path: presetPath, count: items.length };
        })(),
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
    description: '校验文档：结构错误 + 语义警告（重复 id、悬空 ref、未知类型、未定义变量）。项目预设里的变量算已定义',
    inputSchema: { path: z.string() },
    run: (a) => {
      const path = reqStr(a, 'path');
      const loaded = loadDoc(path);
      // 校验看的是「文档自己有什么变量」+「项目预设提供了哪些名字」：
      // 不能拿合并后的文档来校验，否则每个预设变量都会被误判成本地覆盖。
      const presetNames = projectPresetNames(path);
      return validateDoc(loaded.doc, { knownVars: presetNames, presetVars: presetNames });
    },
  },

  paintress_preset: {
    description:
      '项目预设：颜色 / 倒角这类会反复微调的值在项目里存一份（__preset.ptr），设计稿里写 $key 引用。作画前先把颜色与倒角定下来注册成预设；人在查看器里改预设值，画布实时变，不用一句句说「红一点」。action=list 查看，set 新建/改值，remove 删除',
    inputSchema: {
      action: z.enum(['list', 'set', 'remove']),
      path: z.string().optional().describe('设计稿或项目目录，默认当前工作目录'),
      key: z.string().optional().describe('变量名，设计稿里写 $key；set / remove 必填'),
      type: z.enum(['color', 'radius']).optional().describe('预设类型；set 必填'),
      name: z.string().optional().describe('人看的名称，默认同 key'),
      value: z.string().optional().describe("值：颜色写 #RRGGBB（或 #RGB / #RRGGBBAA），倒角写非负数字，如 '8'；set 必填"),
    },
    run: (a) => {
      const from = resolve(optStr(a, 'path') ?? process.cwd());
      const action = optStr(a, 'action') ?? 'list';
      if (action === 'list') {
        const { path, items } = listPresets(from);
        return { ok: true, path, items };
      }
      const key = reqStr(a, 'key');
      if (action === 'remove') return { ok: true, path: presetPathFor(from), items: removePreset(from, key) };
      const type = optStr(a, 'type');
      if (!isPresetType(type)) throw new Error('type 必须是 color 或 radius');
      const name = optStr(a, 'name');
      const items = setPreset(from, {
        key,
        type: type as PresetType,
        value: reqStr(a, 'value'),
        ...(name !== undefined ? { name } : {}),
      });
      return { ok: true, path: presetPathFor(from), items };
    },
  },

  paintress_component: {
    description:
      '项目组件库：先查已有组件再动手，避免重复造轮子。action=list 列出可复用组件（__components.ptr 里 reusable 节点）；action=insert 把某个组件复制进设计稿——复制件自带新 id、内部 ref 已展开，可独立渲染（只复制，不做联动编辑）',
    inputSchema: {
      action: z.enum(['list', 'insert']),
      path: z.string().optional().describe('设计稿或项目目录；insert 时是目标设计稿'),
      id: z.string().optional().describe('组件 id；insert 必填'),
      parent: z.string().optional().describe("插到哪个父节点，默认 'root'"),
      index: z.number().int().min(0).optional(),
    },
    run: (a) => {
      const action = optStr(a, 'action') ?? 'list';
      const from = resolve(optStr(a, 'path') ?? process.cwd());
      if (action === 'list') {
        const compPath = componentsPathFor(from);
        if (compPath === null) return { ok: true, path: null, items: [] };
        return { ok: true, path: compPath, items: listComponents(compPath) };
      }

      const target = reqStr(a, 'path');
      const compId = reqStr(a, 'id');
      const compPath = componentsPathFor(resolve(target));
      if (compPath === null) throw new Error('找不到项目组件库 __components.ptr（先在项目里注册）');
      const compLoaded = readComponentsFile(compPath);
      if (compLoaded === null) throw new Error(`组件库不可读：${compPath}`);

      const warnings: string[] = [];
      // 先展开内部 ref：复制件要自包含，不能带走一个指向组件库的悬空引用
      const expanded = expandRefs(applyProjectPresets(compLoaded.doc, compPath).doc, warnings);
      const node = findNodeIn(expanded, compId);
      if (node === null) throw new Error(`组件不存在：${compId}（先 paintress_component list 看有哪些）`);
      const copy = structuredClone(node);
      // 复制出来的是实例，不是组件定义：整棵子树都摘掉 reusable。
      // 否则组件库里的嵌套组件（ref 展开后仍带 reusable:true）会被复制成新定义，
      // 下次 list 就在设计稿里看到一堆"伪组件"。
      const stripReusable = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        const rec = n as Record<string, unknown>;
        delete rec['reusable'];
        const kids = rec['children'];
        if (Array.isArray(kids)) for (const k of kids) stripReusable(k);
      };
      stripReusable(copy);

      return write(target, (doc, mark) => {
        remapIds(copy, new Set(collectIds(doc.children)));
        const newId = i(doc, optStr(a, 'parent') ?? 'root', copy, optNum(a, 'index'));
        mark([newId]);
        return { id: newId, from: compId, componentPath: compPath, warnings };
      });
    },
  },

  paintress_render: {
    description: '渲染设计稿为 HTML 文件（每节点带 data-node-id）；返回输出路径与画布尺寸',
    inputSchema: {
      path: z.string(),
      out: z.string().describe('输出 .html 路径'),
    },
    run: (a) => {
      const out = reqStr(a, 'out');
      const path = reqStr(a, 'path');
      const loaded = loadDoc(path);
      const r = renderDocument(applyProjectPresets(loaded.doc, path).doc);
      writeFileSync(out, r.html, 'utf8');
      return { ok: true, out, canvas: r.canvas, warnings: r.warnings };
    },
  },

  paintress_screenshot: {
    description:
      '渲染并截图为 PNG（默认 2x）；需要本机 Chromium/Chrome 或 PTR_BROWSER 指向的可执行文件。指定 board 时只截该画板（顶层 frame，即“一页”），而不是整张画布',
    inputSchema: {
      path: z.string(),
      out: z.string().describe('输出 .png 路径'),
      scale: z.number().int().min(1).max(4).optional().describe('像素倍率，默认 2'),
      board: z.string().optional().describe('只截某个画板：id 或 name；模糊命中多个时会报错并列出候选'),
    },
    run: async (a) => {
      const browser = findBrowser();
      if (!browser) throw new Error('未找到可用浏览器：安装 Chromium/Chrome，或设置 PTR_BROWSER');
      const board = typeof a['board'] === 'string' ? a['board'] : '';
      const res = await screenshotPen(reqStr(a, 'path'), reqStr(a, 'out'), {
        ...(typeof a['scale'] === 'number' ? { scale: a['scale'] as number } : {}),
        ...(board !== '' ? { board } : {}),
      });
      return {
        ok: true,
        out: res.out,
        canvas: res.canvas,
        ...(res.board !== undefined ? { board: res.board } : {}),
        browser: res.browser,
        warnings: res.warnings,
      };
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
        throw new Error('paintress web 未运行，无法读取标记；先调用 paintress_viewer（或运行 paintress web --daemon）');
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
