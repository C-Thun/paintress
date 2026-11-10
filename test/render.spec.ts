import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDoc, renderDocument } from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures');

function renderFixture(name: string) {
  const loaded = loadDoc(join(fixtures, name));
  return renderDocument(loaded.doc);
}

describe('basic.pen 渲染', () => {
  const r = renderFixture('basic.pen');

  it('画布尺寸 = 顶层包围盒', () => {
    expect(r.canvas).toEqual({ width: 800, height: 600 });
  });

  it('顶层 frame：绝对定位 + 尺寸 + flex 列布局', () => {
    const html = r.html;
    expect(html).toContain('data-node-id="rootF"');
    expect(html).toContain('position:absolute;left:0px;top:0px');
    expect(html).toContain('width:800px;height:600px');
    expect(html).toContain('display:flex;flex-direction:column');
    expect(html).toContain('gap:12px');
    expect(html).toContain('padding:16px 24px');
    expect(html).toContain('background-color:#FFFFFF');
  });

  it('文本：字号/字重/颜色（$accent 已内联解析）', () => {
    expect(r.html).toContain('data-node-id="title"');
    expect(r.html).toContain('font-size:30px');
    expect(r.html).toContain('font-weight:600');
    expect(r.html).toContain('color:#6BA3FF');
    expect(r.html).toContain('Paintress');
  });

  it('矩形：四元组圆角 + 描边', () => {
    expect(r.html).toContain('border-radius:8px 8px 12px 12px');
    expect(r.html).toContain('border-color:#CBD5E1');
    expect(r.html).toContain('border-width:1px');
  });

  it('图标：lucide SVG 内联', () => {
    expect(r.html).toContain('data-node-id="star"');
    expect(r.html).toContain('lucide-star');
  });

  it('无警告', () => {
    expect(r.warnings).toEqual([]);
  });
});

describe('ref.pen：组件实例展开', () => {
  const r = renderFixture('ref.pen');

  it('实例根保留实例 id，类型为展开后的 frame', () => {
    expect(r.html).toContain('data-node-id="btn2"');
    expect(r.html).toContain('data-node-id="btn2" data-node-type="frame"');
  });

  it('descendants 浅合并生效：label 内容为 Delete', () => {
    expect(r.html).toContain('Delete');
    expect(r.html.match(/Delete/g)?.length).toBe(1); // 只出现在实例里
  });

  it('实例根覆写生效：fill=#EF4444', () => {
    expect(r.html).toContain('background-color:#EF4444');
  });

  it('组件定义本体仍在：btn 渲染且 label 仍为 Submit', () => {
    expect(r.html).toContain('data-node-id="btn"');
    expect(r.html).toContain('Submit');
  });
});

describe('unknown.pen：未知类型与未定义变量', () => {
  const r = renderFixture('unknown.pen');

  it('未知类型渲染为占位框，不炸', () => {
    expect(r.html).toContain('data-node-type="hologram"');
    expect(r.html).toContain('hologram');
  });

  it('未定义变量出警告，字色按原样输出', () => {
    expect(r.warnings.some((w) => w.includes('$ghost'))).toBe(true);
    expect(r.html).toContain('$ghost');
  });
});

describe('尺寸行为字映射（内联构造）', () => {
  it('flex 主轴 fill_container → flex:1 1 0%', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        {
          type: 'frame', id: 'col', x: 0, y: 0, width: 300, height: 200,
          layout: 'vertical',
          children: [{ type: 'rectangle', id: 'filler', width: 100, height: 'fill_container', fill: '#123456' }],
        },
      ],
    });
    expect(r.html).toContain('flex:1 1 0%');
  });

  it('绝对定位 fit_content(fallback) → 回退值 px', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        { type: 'rectangle', id: 'r1', x: 10, y: 10, width: 'fit_content(50)', height: 'fill_container(30)', fill: '#000' },
      ],
    });
    expect(r.html).toContain('width:50px');
    expect(r.html).toContain('height:30px');
  });

  it('渐变：linear-gradient 角度换算（.pen 90°=左 → CSS 270deg）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        {
          type: 'rectangle', id: 'g', x: 0, y: 0, width: 100, height: 100,
          fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#FF0000', position: 0 }, { color: '#0000FF', position: 1 }] },
        },
      ],
    });
    expect(r.html).toContain('linear-gradient(270.0deg');
    expect(r.html).toContain('#FF0000 0.00%');
    expect(r.html).toContain('#0000FF 100.00%');
  });

  it('悬空 ref → 紫色占位 + 警告', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'ref', id: 'bad', ref: 'ghost-component' }],
    });
    expect(r.warnings.some((w) => w.includes('ghost-component'))).toBe(true);
    expect(r.html).toContain('#FF00FF');
  });
});

describe('变量识别边界（$ 前缀不能过宽）', () => {
  it('以 $ 开头但不是变量名的普通文本：原样渲染且无警告', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'text', id: 't', content: '$5 起 / $accent 等令牌说明' }],
    });
    expect(r.html).toContain('$5 起 / $accent 等令牌说明');
    expect(r.warnings).toEqual([]);
  });

  it('ctx 中的价格类文本不被当作变量', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'text', id: 't2', content: '$99' }],
    });
    expect(r.html).toContain('$99');
    expect(r.warnings).toEqual([]);
  });

  it('真正的 $name 引用仍然解析', () => {
    const r = renderDocument({
      version: '2.21',
      variables: { accent: { type: 'color', value: '#123456' } },
      children: [{ type: 'rectangle', id: 'r', width: 10, height: 10, fill: '$accent' }],
    });
    expect(r.html).toContain('#123456');
    expect(r.warnings).toEqual([]);
  });

  it('未定义的 $name 仍按警告处理', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'rectangle', id: 'r2', width: 10, height: 10, fill: '$nope' }],
    });
    expect(r.warnings.some((w) => w.includes('$nope'))).toBe(true);
  });
});
