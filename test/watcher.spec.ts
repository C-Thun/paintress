import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WatchManager } from '../src/web/watcher.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  expect(predicate()).toBe(true);
}

describe('设计稿目录监听', () => {
  let root: string;
  let manager: WatchManager;
  let events: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paintress-design-watch-'));
    manager = new WatchManager();
    events = [];
  });

  afterEach(async () => {
    await manager.closeAll();
    rmSync(root, { recursive: true, force: true });
  });

  it('只推 .ptr/.pen 的新增，不因普通文件改动刷新', async () => {
    await manager.watchDesigns(root, 3, (file) => events.push(file)).ready;
    writeFileSync(join(root, 'notes.txt'), 'not a design');
    await delay(250);
    expect(events).toEqual([]);

    writeFileSync(join(root, 'new.ptr'), '{}');
    await waitFor(() => events.some((file) => file.endsWith('new.ptr')));
  });

  it('跳过隐藏/构建目录，遵守项目扫描深度', async () => {
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
    mkdirSync(join(root, 'nested/deep'), { recursive: true });
    await manager.watchDesigns(root, 1, (file) => events.push(file)).ready;
    writeFileSync(join(root, 'node_modules/pkg/ignored.ptr'), '{}');
    writeFileSync(join(root, 'nested/deep/too-deep.ptr'), '{}');
    await delay(250);
    expect(events).toEqual([]);

    writeFileSync(join(root, 'nested/allowed.pen'), '{}');
    await waitFor(() => events.some((file) => file.endsWith('allowed.pen')));
  });
});
