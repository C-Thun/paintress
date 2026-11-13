import { spawn } from 'node:child_process';

/**
 * 在宿主机上打开浏览器。
 *
 * 设计前提（operator 2026-11-13）：界面状态由 agent 侧驱动，
 * 人不需要去记「进程起没起、项目绑没绑」—— agent 第一次把项目交给 web 时，
 * 浏览器就该自己弹出来，并且直接落在那个项目上。
 *
 * 关闭方式：`PAINTRESS_NO_OPEN=1`（CI、远程服务器、或在 SSH 里跑 agent 时用）。
 * 无图形环境（Linux 无 DISPLAY / WAYLAND_DISPLAY）自动跳过，不报错。
 */
export function openBrowser(url: string): boolean {
  if (process.env['PAINTRESS_NO_OPEN'] === '1') return false;
  if (process.env['CI'] === '1' || process.env['CI'] === 'true') return false;

  const platform = process.platform;
  if (platform === 'linux' && !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY']) return false;

  const [cmd, args] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    // 失败（没装 xdg-open、无权限）不能影响 daemon/MCP
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** 顶层页面地址（项目列表）；项目深链见 projectUrl */
export function baseUrl(port: number): string {
  return `http://localhost:${port}/`;
}

/** 项目深链：项目 key 本身就带 `/`（`c-thun/raybend`），URL 里不需要转义 */
export function projectUrl(port: number, project?: string, file?: string): string {
  if (!project) return baseUrl(port);
  const path = project
    .split('/')
    .filter((s) => s !== '')
    .map(encodeURIComponent)
    .join('/');
  const qs = file ? `?file=${encodeURIComponent(file)}` : '';
  return `http://localhost:${port}/${path}${qs}`;
}
