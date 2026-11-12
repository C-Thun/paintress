/**
 * 查看器界面文案（中/英）。
 *
 * 规则：默认跟随浏览器语言，`navigator.language` 以 zh 开头为中文，其余一律英文
 * （operator 2026-11-12 定：「支持检测浏览器设置的语言，不是中文就是英文」）。
 * 用户手动切换后写入 localStorage，优先于浏览器语言。
 */

export type Lang = 'zh' | 'en';

export interface Messages {
  projects: string;
  noProjects: string;
  projectFiles: (count: number) => string;
  designs: string;
  depth: string;
  noFiles: string;
  marks: string;
  clear: string;
  liveReload: string;
  refreshList: string;
  pickProject: string;
  pickFile: string;
  fit: string;
  fitTitle: string;
  actualSize: string;
  actualSizeTitle: string;
  rerender: string;
  allBoards: string;
  canvasBackground: string;
  language: string;
}

const MESSAGES: Record<Lang, Messages> = {
  zh: {
    projects: '项目',
    noProjects: '还没有注册项目',
    projectFiles: (count) => `${count} 个设计稿`,
    designs: '设计稿',
    depth: 'depth',
    noFiles: '没有 .ptr / .pen 文件',
    marks: '标记',
    clear: '清空',
    liveReload: '实时刷新',
    refreshList: '刷新列表',
    pickProject: '从左侧选择项目',
    pickFile: '从左侧选择一个设计稿',
    fit: '适应',
    fitTitle: '适应窗口（Shift+1）',
    actualSize: '1:1',
    actualSizeTitle: '100%（Ctrl/Cmd+0）',
    rerender: '重新渲染',
    allBoards: '全部',
    canvasBackground: '画布背景',
    language: '界面语言',
  },
  en: {
    projects: 'Projects',
    noProjects: 'No projects registered yet',
    projectFiles: (count) => `${count} design${count === 1 ? '' : 's'}`,
    designs: 'Designs',
    depth: 'depth',
    noFiles: 'No .ptr / .pen files',
    marks: 'Marks',
    clear: 'Clear',
    liveReload: 'Live reload',
    refreshList: 'Refresh',
    pickProject: 'Pick a project on the left',
    pickFile: 'Pick a design on the left',
    fit: 'Fit',
    fitTitle: 'Fit to window (Shift+1)',
    actualSize: '1:1',
    actualSizeTitle: '100% (Ctrl/Cmd+0)',
    rerender: 'Re-render',
    allBoards: 'All',
    canvasBackground: 'Canvas background',
    language: 'Language',
  },
};

export function messages(lang: Lang): Messages {
  return MESSAGES[lang];
}

interface BrowserLanguage {
  language?: string;
  languages?: readonly string[];
}

/** 浏览器语言 → 界面语言：中文（zh / zh-CN / zh-TW …）之外全部归英文 */
export function detectLang(nav: BrowserLanguage | undefined): Lang {
  const first = nav?.languages?.[0] ?? nav?.language ?? '';
  return first.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const LANG_KEY = 'paintress:lang';

export function isLang(value: unknown): value is Lang {
  return value === 'zh' || value === 'en';
}

/** 已存的手动选择优先，否则按浏览器语言检测 */
export function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* 存储不可用时忽略 */
  }
  return detectLang(typeof navigator === 'undefined' ? undefined : navigator);
}

export function rememberLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* 存储不可用时忽略 */
  }
}
