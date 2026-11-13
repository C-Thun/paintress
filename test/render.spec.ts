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

describe('icon-font.pen：上游 icon_font 写法', () => {
  const r = renderFixture('icon-font.pen');

  it('icon_font 按 icon 渲染：lucide SVG 内联，不是占位框', () => {
    expect(r.html).toContain('data-node-id="logoIcon"');
    expect(r.html).toContain('lucide-message-square');
    expect(r.html).toContain('lucide-search');
    expect(r.html).not.toContain('icon_font:');
  });

  it('缺 iconFontFamily 时按 lucide 处理', () => {
    expect(r.html).toContain('lucide-search');
    expect(r.warnings.some((w) => w.includes('noFamily'))).toBe(false);
  });

  it('iconFontName 支持变量引用', () => {
    expect(r.html).toContain('lucide-check');
    expect(r.warnings.some((w) => w.includes('variableName'))).toBe(false);
  });

  it('图标名不存在 → 占位框 + 警告，不炸', () => {
    expect(r.html).toContain('lucide:not-a-real-icon');
    expect(r.warnings.some((w) => w.includes('not-a-real-icon'))).toBe(true);
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

  it('渐变：linear-gradient 角度换算（0=从左往右 → CSS 90deg；90=向上 → 0deg）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        {
          type: 'rectangle', id: 'g', x: 0, y: 0, width: 100, height: 100,
          fill: { type: 'gradient', gradientType: 'linear', rotation: 90, colors: [{ color: '#FF0000', position: 0 }, { color: '#0000FF', position: 1 }] },
        },
      ],
    });
    expect(r.html).toContain('linear-gradient(0.0deg'); // pen 90（向上）= CSS 0deg
    expect(r.html).toContain('#FF0000 0.00%');
    expect(r.html).toContain('#0000FF 100.00%');
  });

  it('渐变 0°：光带沿水平轴（从左往右飘），不是横着的一大块', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{
        type: 'rectangle', id: 'streak', x: 0, y: 0, width: 96, height: 58,
        fill: { type: 'gradient', gradientType: 'linear', rotation: 0, colors: [{ color: '#00000000', position: 0 }, { color: '#F6F8F4', position: 0.5 }, { color: '#00000000', position: 1 }] },
      }],
    } as never);
    expect(r.html).toContain('linear-gradient(90.0deg'); // to right
  });

  it('悬空 ref → 紫色占位 + 警告', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'ref', id: 'bad', ref: 'ghost-component' }],
    });
    expect(r.warnings.some((w) => w.includes('ghost-component'))).toBe(true);
    expect(r.html).toContain('#FF00FF');
  });

  it('非绝对定位节点也是 containing block（absolute 子节点不越过父级）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        {
          type: 'frame', id: 'outer', x: 0, y: 0, width: 300, height: 100, layout: 'vertical',
          children: [
            {
              type: 'frame', id: 'row', x: 0, y: 0, width: 200, height: 40, layout: 'horizontal',
              children: [{ type: 'rectangle', id: 'badge', layoutPosition: 'absolute', x: 8, y: 0, width: 10, height: 10 }],
            },
          ],
        },
      ],
    });
    expect(r.html).toMatch(/data-node-id="row"[^>]*position:relative/);
    expect(r.html).toMatch(/data-node-id="badge"[^>]*position:absolute;left:8px;top:0px/);
  });

  it('布局子节点 flex-shrink:0（不被 CSS 压缩成竖排文字）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        {
          type: 'frame', id: 'row2', x: 0, y: 0, width: 100, height: 24, layout: 'horizontal',
          children: [{ type: 'text', id: 'label', content: '总览' }],
        },
      ],
    });
    expect(r.html).toMatch(/data-node-id="label"[^>]*flex-shrink:0/);
  });

  it('flex 容器缺省 alignItems 按 spec 的 start（不是 CSS 的 stretch）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        { type: 'frame', id: 'row3', x: 0, y: 0, width: 100, height: 24, layout: 'horizontal', children: [] },
      ],
    });
    expect(r.html).toMatch(/data-node-id="row3"[^>]*align-items:flex-start/);
  });

  it('enabled=false 的节点整棵跳过（设计稿里的开关式隐藏层）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [
        { type: 'frame', id: 'host', x: 0, y: 0, width: 100, height: 100, children: [
          { type: 'text', id: 'hidden-note', content: 'GPU 占位说明', enabled: false },
          { type: 'text', id: 'shown-note', content: '保留' },
        ] },
      ],
    });
    expect(r.html).not.toContain('GPU 占位说明');
    expect(r.html).not.toContain('hidden-note');
    expect(r.html).toContain('保留');
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

describe('画布元数据 data-board*（阶段 6 步 1）', () => {
  it('顶层节点带 data-board="1" 与几何盒', () => {
    const r = renderFixture('basic.pen');
    expect(r.html).toContain(
      'data-node-id="rootF" data-node-type="frame" data-node-name="App" data-board="1" data-board-name="App" data-board-x="0" data-board-y="0" data-board-w="800" data-board-h="600"',
    );
  });

  it('嵌套节点不带画布元数据', () => {
    const r = renderFixture('basic.pen');
    const tag = /<div [^>]*data-node-id="title"[^>]*>/.exec(r.html)?.[0] ?? '';
    expect(tag).toContain('data-node-id="title"');
    expect(tag).not.toContain('data-board');
  });

  it('多画板：每个顶层节点带偏移几何，画布为包围盒', () => {
    const r = renderFixture('boards.pen');
    expect(r.html.match(/data-board="1"/g)?.length).toBe(3);
    expect(r.html).toContain(
      'data-node-id="detail" data-node-type="frame" data-node-name="详情" data-board="1" data-board-name="详情" data-board-x="900" data-board-y="0" data-board-w="400" data-board-h="300"',
    );
    expect(r.canvas).toEqual({ width: 1300, height: 600 }); // 900+400 是最大右边界
  });

  it('无名字的画板不输出 data-board-name（回退由前端负责）', () => {
    const r = renderFixture('boards.pen');
    const tag = /<div [^>]*data-node-id="ghost"[^>]*>/.exec(r.html)?.[0] ?? '';
    expect(tag).toContain('data-board="1"');
    expect(tag).toContain('data-board-w="200"');
    expect(tag).not.toContain('data-board-name');
  });
});

describe('主题与密度（v2.21 变量的 themed 列表）', () => {
  const doc = {
    version: '2.21',
    variables: {
      surface: {
        type: 'color',
        value: [
          { value: '#202226', theme: { mode: 'dark' } },
          { value: '#F6F8F4', theme: { mode: 'light' } },
        ],
      },
      'row-h': { type: 'number', value: [{ value: 28, theme: { density: 'compact' } }, { value: 36, theme: { density: 'loose' } }] },
    },
    children: [
      {
        type: 'frame', id: 'light', x: 0, y: 0, width: 100, height: 100,
        theme: { mode: 'light', density: 'loose' },
        fill: '$surface', gap: '$row-h', layout: 'vertical',
        children: [],
      },
      {
        type: 'frame', id: 'dark', x: 200, y: 0, width: 100, height: 100,
        theme: { mode: 'dark', density: 'compact' },
        fill: '$surface', gap: '$row-h', layout: 'vertical',
        children: [],
      },
    ],
  };

  it('同一份稿子里的 light / dark 板子各取自己的颜色与尺寸', () => {
    const r = renderDocument(doc as never);
    const light = r.html.slice(r.html.indexOf('data-node-id="light"'));
    const dark = r.html.slice(r.html.indexOf('data-node-id="dark"'));
    expect(light.slice(0, 400)).toContain('background-color:#F6F8F4');
    expect(light.slice(0, 400)).toContain('gap:36px');
    expect(dark.slice(0, 400)).toContain('background-color:#202226');
    expect(dark.slice(0, 400)).toContain('gap:28px');
  });

  it('子节点继承父级主题（不必每层都写 theme）', () => {
    const r = renderDocument({
      version: '2.21',
      variables: { fg: { type: 'color', value: [{ value: '#fff', theme: { mode: 'dark' } }, { value: '#000', theme: { mode: 'light' } }] } },
      children: [
        {
          type: 'frame', id: 'host', x: 0, y: 0, width: 100, height: 100, theme: { mode: 'light' }, layout: 'vertical',
          children: [{ type: 'text', id: 'caption', content: 'hi', fill: '$fg' }],
        },
      ],
    } as never);
    const caption = r.html.slice(r.html.indexOf('data-node-id="caption"'));
    expect(caption.slice(0, 300)).toContain('color:#000');
  });
});

describe('填充与描边的兼容细节', () => {
  it('文本渐变填充 → background-clip:text，而不是丢掉渐变', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{
        type: 'text', id: 't', content: '渐隐标题',
        fill: { type: 'gradient', gradientType: 'linear', rotation: 0, colors: [{ color: '#00000000', position: 0 }, { color: '#B6B0AF', position: 1 }] },
      }],
    } as never);
    const tag = r.html.slice(r.html.indexOf('data-node-id="t"'));
    expect(tag.slice(0, 500)).toContain('linear-gradient');
    expect(tag.slice(0, 500)).toContain('background-clip:text');
    expect(tag.slice(0, 500)).toContain('-webkit-text-fill-color:transparent');
  });

  it('strokeAlignment=outer → outline（不再按 inner 画）', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 10, height: 10, stroke: '#52C6AB', strokeWidth: 2, strokeAlignment: 'outer' }],
    } as never);
    const tag = r.html.slice(r.html.indexOf('data-node-id="box"'));
    expect(tag.slice(0, 300)).toContain('outline:2px solid #52C6AB');
    expect(tag.slice(0, 300)).not.toContain('border-width:2px');
    expect(r.warnings.some((w) => w.includes('strokeAlignment'))).toBe(false);
  });

  it('enabled:false 的填充层被跳过', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{
        type: 'rectangle', id: 'r', x: 0, y: 0, width: 10, height: 10,
        fill: [{ type: 'color', color: '#111111', enabled: false }],
      }],
    } as never);
    expect(r.html).not.toContain('#111111');
  });

  it('Material Symbols 走 lucide 别名，不再整块占位框', () => {
    const r = renderDocument({
      version: '2.21',
      children: [{ type: 'icon', id: 'i', library: 'Material Symbols Rounded', icon: 'delete_forever', width: 16, height: 16, fill: '#000' }],
    } as never);
    expect(r.html).toContain('<svg');
    expect(r.html).not.toContain('暂无');
    expect(r.warnings.some((w) => w.includes('占位框'))).toBe(false);
  });
});
