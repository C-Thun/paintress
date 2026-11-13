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
  unwatch: string;
  unwatchTitle: string;
  unwatchBody: (name: string) => string;
  closeServer: string;
  closeServerTitle: string;
  closeServerBody: (pid: number, connections: number) => string;
  cancel: string;
  serverClosed: string;
  serverClosedHint: string;
  updateAvailable: (latest: string, current: string) => string;
  updateTitle: string;
  updatePrompt: string;
  updateSteps: string;
  updateRepo: string;
  copy: string;
  copied: string;
  close: string;
  versionTitle: string;
  /** 项目行上的 agent 在线指示灯悬停文案 */
  agentOnline: string;
  /** 无激活项目时的关窗倒计时 */
  noActiveProjects: string;
  closingIn: (seconds: number) => string;
  /** 刚打开页面、还没有任何项目时的等待文案 */
  waitingForAgent: string;
  /** 画布左侧笔记抽屉 / 右上浮动工具条与面板 */
  notes: string;
  notesTitle: string;
  canvasTools: string;
  presets: string;
  components: string;
  closePanel: string;
  presetEmpty: string;
  presetHint: string;
  presetColor: string;
  presetRadius: string;
  componentsEmpty: string;
  componentsHint: string;
  componentsCount: (count: number) => string;
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
    unwatch: '解绑',
    unwatchTitle: '解绑项目',
    unwatchBody: (name) =>
      `「${name}」将从项目列表中移除。设计稿文件不受影响；agent 下次启动会自动重新注册。`,
    closeServer: '关闭服务器',
    closeServerTitle: '关闭 web 进程',
    closeServerBody: (pid, connections) =>
      `将断开 ${connections} 个长连接并停止进程 pid ${pid}。之后可用 paintress web 重新启动。`,
    cancel: '取消',
    serverClosed: '服务已关闭',
    serverClosedHint: '可以关闭此页面；需要时重新启动 paintress web。',
    updateAvailable: (latest, current) => `新版 v${latest}（当前 v${current}）`,
    updateTitle: '有新版本',
    updatePrompt: '把 paintress 升级到最新版：npm install -g paintress@latest，完成后重启 MCP 会话。',
    updateSteps: '把上面这句话交给你的 AI 即可；或自己在终端执行那条命令。',
    updateRepo: 'GitHub',
    copy: '复制',
    copied: '已复制',
    close: '关闭',
    versionTitle: '版本',
    agentOnline: 'agent 已接入',
    noActiveProjects: '无激活项目',
    closingIn: (seconds) => `窗口将在 ${seconds} 秒后关闭`,
    waitingForAgent: '等待 agent 接入 —— 在项目里让 AI 操作设计稿，这里会自动出现。',
    notes: '笔记',
    notesTitle: '设计笔记',
    canvasTools: '画布工具',
    presets: '预设',
    components: '组件',
    closePanel: '关闭',
    presetEmpty: '还没有预设。让 agent 先把颜色和倒角定下来。',
    presetHint: '改一个值，画布立刻更新。',
    presetColor: '颜色',
    presetRadius: '倒角',
    componentsEmpty: '还没有组件。让 agent 把做好的组件登记进组件库。',
    componentsHint: '画新组件之前，先看这里有没有能复用的。',
    componentsCount: (count) => `${count} 个组件`,
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
    unwatch: 'Unbind',
    unwatchTitle: 'Unbind project',
    unwatchBody: (name) =>
      `“${name}” will be removed from the project list. Design files are untouched; the agent re-registers it on next start.`,
    closeServer: 'Stop server',
    closeServerTitle: 'Stop web process',
    closeServerBody: (pid, connections) =>
      `This drops ${connections} live connection${connections === 1 ? '' : 's'} and stops process pid ${pid}. Restart later with paintress web.`,
    cancel: 'Cancel',
    serverClosed: 'Server stopped',
    serverClosedHint: 'You can close this page; run paintress web to start it again.',
    updateAvailable: (latest, current) => `v${latest} available (running v${current})`,
    updateTitle: 'Update available',
    updatePrompt: 'Upgrade paintress to the latest version: npm install -g paintress@latest, then restart the MCP session.',
    updateSteps: 'Hand that line to your AI, or run the command yourself in a terminal.',
    updateRepo: 'GitHub',
    copy: 'Copy',
    copied: 'Copied',
    close: 'Close',
    versionTitle: 'Version',
    agentOnline: 'Agent attached',
    noActiveProjects: 'No active projects',
    closingIn: (seconds) => `This window closes in ${seconds}s`,
    waitingForAgent: 'Waiting for an agent — ask your AI to touch a design and it shows up here automatically.',
    notes: 'Notes',
    notesTitle: 'Design notes',
    canvasTools: 'Canvas tools',
    presets: 'Presets',
    components: 'Components',
    closePanel: 'Close',
    presetEmpty: 'No presets yet. Ask the agent to fix colors and corner radii first.',
    presetHint: 'Change a value and the canvas updates immediately.',
    presetColor: 'Colors',
    presetRadius: 'Corner radius',
    componentsEmpty: 'No components yet. Ask the agent to register the ones it built.',
    componentsHint: 'Check here before building a new component.',
    componentsCount: (count) => `${count} component${count === 1 ? '' : 's'}`,
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
