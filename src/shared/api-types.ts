/**
 * 前后端共享的 API 类型（纯类型，无运行时依赖）。
 * 服务端 src/web/marks.ts 与前端 ui/src/api.ts 都从这里引用，
 * 避免同一契约在两侧各写一份导致漂移。
 */

/** 会话级标记：用户在浏览器里点击的节点被分配短号 #1 #2… */
export interface Mark {
  /** 短号，从 1 递增（全局，跨项目不重复） */
  shortId: number;
  project: string;
  nodeId: string;
  name?: string;
  type?: string;
  /** 祖先链展示串，如 "App / Card / Title" */
  path: string;
  at: number;
}

/** 创建标记的入参 */
export interface MarkInput {
  project: string;
  nodeId: string;
  name?: string;
  type?: string;
  path?: string;
}
