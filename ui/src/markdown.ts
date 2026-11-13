/**
 * 设计稿笔记的 Markdown 渲染（规格见 specs/notes-drawer.md）。
 *
 * - **懒加载**：marked 只在第一次打开笔记抽屉时才下载（Vite 切成独立 chunk），首屏体积不受影响。
 * - **输出策略**：笔记与查看器同源，裸 `innerHTML` 会被 `<img onerror>` 打到查看器自己的写接口
 *   （解绑项目、关服务）。所以原样 HTML 一律转义成文本，链接只放行 http(s)/mailto/#。
 *   解析交给 marked，安全边界只做这一层，不自己写 Markdown 解析。
 */

type MarkedModule = typeof import('marked');

let loading: Promise<MarkedModule> | null = null;

function loadMarked(): Promise<MarkedModule> {
  loading ??= import('marked');
  return loading;
}

const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/)/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

/** Markdown → 安全 HTML。失败时抛出，由调用方展示错误态（不让抽屉白屏）。 */
export async function renderMarkdown(source: string): Promise<string> {
  const { Marked } = await loadMarked();
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    // 原样 HTML 不执行：当作代码文本显示（agent 写的笔记里出现 <div> 也看得见）
    renderer: {
      html(token) {
        return escapeHtml(token.text);
      },
      link(token) {
        const href = SAFE_HREF.test(token.href) ? token.href : '#';
        const title = token.title !== null && token.title !== undefined ? ` title="${escapeAttr(token.title)}"` : '';
        const text = this.parser.parseInline(token.tokens);
        return `<a href="${escapeAttr(href)}"${title} target="_blank" rel="noreferrer noopener">${text}</a>`;
      },
      image(token) {
        const src = SAFE_HREF.test(token.href) ? token.href : '';
        if (src === '') return escapeHtml(token.text ?? '');
        const title = token.title !== null && token.title !== undefined ? ` title="${escapeAttr(token.title)}"` : '';
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(token.text ?? '')}"${title} loading="lazy">`;
      },
    },
    // 兜底：链接/图片以外的危险协议也在这里掐掉（如引用式链接）
    walkTokens(token) {
      if ((token.type === 'link' || token.type === 'image') && !SAFE_HREF.test(token.href)) {
        token.href = '';
      }
    },
  });
  return md.parse(source, { async: false });
}
