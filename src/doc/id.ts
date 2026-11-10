/** id 生成：5 位 base62，禁 '/'。与既有文档 id 风格一致（如 zae8o、bi8Au）。 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function genId(taken: Set<string>, rand: () => number = Math.random): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let id = '';
    for (let i = 0; i < 5; i++) {
      id += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    }
    if (!taken.has(id)) return id;
  }
  throw new Error('无法生成唯一 id（64 次尝试均碰撞，文档 id 空间异常）');
}

/** 收集文档内全部节点 id（含重复，供冲突检测） */
export function collectIds(children: unknown[], out: string[] = []): string[] {
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const node = child as Record<string, unknown>;
    if (typeof node['id'] === 'string') out.push(node['id']);
    const kids = node['children'];
    if (Array.isArray(kids)) collectIds(kids, out);
  }
  return out;
}
