# 2026-11-12T21:54+08:00 — 变更高亮：线宽保持 2px，脉冲改为 2s 透明度循环

按 operator 2026-11-12 的决定：**线宽不改**（1px 会与设计本身的描边混在一起，2px 的辨识度要保住），只柔化脉冲。

`ui/src/App.tsx` 注入 iframe 的那段 CSS（`ensureFrameStyle`）：

- 原来：`inset 0 0 0 2px #908030` + `ptr-pulse 1.4s ease-in-out 3`（三下后停住）。
- 现在：`inset 0 0 0 2px rgba(144,128,48,1)` + `ptr-pulse 2s ease-in-out infinite`，关键帧在 `rgba(144,128,48,1)` 与 `rgba(144,128,48,.25)` 之间往返——即 operator 要的「25% 到 100% 透明度循环」。
- 另加 `@media (prefers-reduced-motion: reduce)` 关动画（持续动画对前庭敏感用户不友好，且不影响正常视觉）。

变更记录源仍是 daemon 侧 60s TTL（`src/web/changes.ts`），本次只动前端表现。
