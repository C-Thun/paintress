export { makeVarResolver, type VarResolver, type VarValue, type Warnings } from './vars.js';
export { expandRefs } from './expand.js';
export {
  fillsToCss, strokeToCss, effectsToCss, textToCss, commonToCss, cornerRadiusToCss,
  type CSSDecl,
} from './style.js';
export { getLucideIcon } from './icons.js';
export { computeCanvas, renderTree, escapeHtml, escapeAttr, boardBoxes, type BoardBox } from './html.js';
export { renderDocument, type RenderResult, type RenderOptions } from './entry.js';
