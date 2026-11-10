import { connect, type Socket } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { LineDecoder, encodeLine, type ClientRequest, type ServerResponse } from './protocol.js';
import { socketPath, pidPath } from './paths.js';

/** 控制面客户端：一次请求/响应，或保持长连接（attach 用） */

export function isDaemonRunning(): boolean {
  return existsSync(socketPath());
}

function connectSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath());
    const onError = (err: Error): void => {
      sock.destroy();
      reject(new Error(`无法连接 paintress web（${socketPath()}）：${err.message}`));
    };
    sock.once('error', onError);
    sock.once('connect', () => {
      sock.off('error', onError);
      // 后续错误交由调用方处理
      sock.on('error', () => {});
      resolve(sock);
    });
  });
}

/** 单次请求；超时默认 5s */
export async function sendRequest(req: ClientRequest, timeoutMs = 5000): Promise<ServerResponse> {
  const sock = await connectSocket();
  return new Promise<ServerResponse>((resolve, reject) => {
    const decoder = new LineDecoder();
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`请求超时（${timeoutMs}ms）`));
    }, timeoutMs);
    sock.on('data', (chunk: Buffer) => {
      for (const line of decoder.push(chunk.toString('utf8'))) {
        let parsed: ServerResponse;
        try {
          parsed = JSON.parse(line) as ServerResponse;
        } catch {
          continue;
        }
        clearTimeout(timer);
        sock.end();
        resolve(parsed);
        return;
      }
    });
    sock.on('close', () => {
      clearTimeout(timer);
      reject(new Error('daemon 在响应前关闭了连接'));
    });
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.write(encodeLine(req));
  });
}

export interface AttachHandle {
  close(): void;
  /** daemon 主动关闭连接时触发（如 shutdown） */
  onClose(cb: () => void): void;
}

/**
 * 持久 attach：连接保持打开，进程退出时 OS 关闭连接 → daemon 立即感知。
 * 这取代了 PID 轮询（PID 会被内核复用，不可靠）。
 */
export async function attachPersistent(project: string): Promise<AttachHandle> {
  const sock = await connectSocket();
  const decoder = new LineDecoder();
  let closed = false;
  const closeCbs: (() => void)[] = [];

  return new Promise<AttachHandle>((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('attach 超时'));
    }, 5000);

    sock.on('data', (chunk: Buffer) => {
      for (const line of decoder.push(chunk.toString('utf8'))) {
        let parsed: ServerResponse;
        try {
          parsed = JSON.parse(line) as ServerResponse;
        } catch {
          continue;
        }
        if (parsed.ok && 'attached' in parsed) {
          clearTimeout(timer);
          resolve({
            close: () => {
              if (closed) return;
              closed = true;
              sock.end();
            },
            onClose: (cb) => closeCbs.push(cb),
          });
        } else if (!parsed.ok) {
          clearTimeout(timer);
          sock.destroy();
          reject(new Error(parsed.error));
        }
      }
    });
    sock.on('close', () => {
      closed = true;
      for (const cb of closeCbs) cb();
    });
    sock.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.write(encodeLine({ kind: 'attach', project }));
  });
}

export function daemonPid(): number | null {
  try {
    const raw = readFileSync(pidPath(), 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
