/**
 * 父页面注入设计稿 iframe 的交互样式。
 * 独立成模块是为了让浏览器回归测试直接使用同一份 CSS，避免测试复制后失去约束。
 */
export const FRAME_STYLE = [
  '[data-ptr-selected]{outline:2px solid #908030 !important;outline-offset:-2px;}',
  '[data-ptr-hover]:not([data-ptr-selected]){outline:1px dashed rgba(144,128,48,.55) !important;outline-offset:-2px;}',
  // 变更高亮：线宽保持 2px（1px 会与设计本身的描边混为一谈），只做缓慢的透明度往返。
  // box-shadow 不能带 !important：重要声明会压过关键帧，透明度循环将完全不生效。
  '[data-ptr-changed]{box-shadow:inset 0 0 0 2px rgba(144,128,48,1);animation:ptr-pulse 2s ease-in-out infinite;}',
  '@keyframes ptr-pulse{0%,100%{box-shadow:inset 0 0 0 2px rgba(144,128,48,1)}50%{box-shadow:inset 0 0 0 2px rgba(144,128,48,.25)}}',
  '@media (prefers-reduced-motion: reduce){[data-ptr-changed]{animation:none !important;}}',
  'html{cursor:default;}',
  'html,body{overflow:hidden;}',
  // 画布背景由父页面注入（CanvasBgSwitch），#fff 为未设置时的兜底
  'html,body{background:var(--ptr-canvas-bg,#ffffff);}',
].join('\n');
