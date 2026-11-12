import { randomUUID } from 'node:crypto';
import { genId } from './id.js';
import { DocumentSchema, PEN_DOC_VERSION, type PenDocument } from '../schema/index.js';

/**
 * 新建文档（.ptr 为 paintress 的标准格式，见 format/README.md#双格式策略）。
 *
 * 产出「一个 board + 零个子节点」的最小可用文档：可直接 render / screenshot，
 * 也适合让 AI 用 `insert` 逐层往里加节点。默认 board 用纵向 flex，避免调用方
 * 一开始就要算 x/y（绝对定位仍是 layout 未设时的默认行为）。
 */
export interface CreateDocOptions {
  /** board 名称，默认 "Board" */
  name?: string;
  /** board 宽，默认 900 */
  width?: number;
  /** board 高，默认 600 */
  height?: number;
  /** board 背景色，默认 #FFFFFF（无填充的 board 在查看器里会与画布底混在一起） */
  fill?: string;
  /** board 子节点布局，默认 vertical */
  layout?: 'vertical' | 'horizontal' | 'none';
  /** board 内边距（数字或 [纵向, 横向]），默认 0 */
  padding?: number | [number, number];
  /** board 主轴向间距，默认 0 */
  gap?: number;
  /** board 节点 id，默认随机 5 位 */
  boardId?: string;
  /** 文档 fileToken，默认随机 UUID */
  fileToken?: string;
}

export interface CreatedDoc {
  doc: PenDocument;
  boardId: string;
}

export function createDoc(opts: CreateDocOptions = {}): CreatedDoc {
  const boardId = opts.boardId ?? genId(new Set());
  const board: Record<string, unknown> = {
    type: 'frame',
    id: boardId,
    name: opts.name ?? 'Board',
    x: 0,
    y: 0,
    width: opts.width ?? 900,
    height: opts.height ?? 600,
    fill: opts.fill ?? '#FFFFFF',
  };
  const layout = opts.layout ?? 'vertical';
  if (layout !== 'none') {
    board['layout'] = layout;
    board['gap'] = opts.gap ?? 0;
    board['padding'] = opts.padding ?? 0;
  }

  // 走一遍 schema：返回值即为 PenDocument，同时兼作「新文档必合法」的自检，不做类型断言
  const doc = DocumentSchema.parse({
    version: PEN_DOC_VERSION,
    fileToken: opts.fileToken ?? randomUUID(),
    variables: {},
    children: [board],
  });

  return { doc, boardId };
}
