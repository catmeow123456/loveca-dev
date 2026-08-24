import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DonutChart } from './DonutChart';

describe('DonutChart', () => {
  it('把调用方准备的序列渲染为带图例的可访问 SVG', () => {
    const markup = renderToStaticMarkup(
      createElement(DonutChart, {
        title: '赛季卡组使用率',
        ariaLabel: '当前赛季卡组使用率环形图',
        data: [
          { id: 'deck-a', label: '卡组 A', value: 60, color: '#e95678' },
          { id: 'deck-b', label: '卡组 B', value: 40, color: '#6fcbd0' },
        ],
      })
    );

    expect(markup).toContain('<svg');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="当前赛季卡组使用率环形图"');
    expect(markup).toContain('<title');
    expect(markup).toContain('stroke-dasharray="60 40"');
    expect(markup).toContain('stroke-dasharray="40 60"');
    expect(markup.match(/donut-chart__legend-item/g)).toHaveLength(2);
  });

  it('没有有效正数时渲染可访问空状态', () => {
    const markup = renderToStaticMarkup(
      createElement(DonutChart, {
        ariaLabel: '卡组使用率',
        emptyLabel: '本赛季暂无数据',
        data: [
          { id: 'zero', label: '零样本', value: 0, color: '#e95678' },
          { id: 'invalid', label: '无效样本', value: Number.NaN, color: '#6fcbd0' },
        ],
      })
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="卡组使用率"');
    expect(markup).toContain('本赛季暂无数据');
    expect(markup).not.toContain('<svg');
  });

  it('保留调用方的排名和聚合决策，并可避免重复显示已是百分比的值', () => {
    const markup = renderToStaticMarkup(
      createElement(DonutChart, {
        ariaLabel: '卡组分布',
        showNormalizedPercentage: false,
        data: [
          { id: 'first', label: '同系卡组', value: 3, color: '#e95678' },
          { id: 'second', label: '同系卡组', value: 2, color: '#f29862' },
          { id: 'other', label: '其他', value: 5, color: '#6fcbd0' },
        ],
      })
    );

    expect(markup.match(/donut-chart__segment/g)).toHaveLength(3);
    expect(markup.match(/donut-chart__legend-item/g)).toHaveLength(3);
    expect(markup).not.toContain('donut-chart__legend-percentage');
  });

  it('为每个饼图扇区独立缩放卡图并移除无意义的中心总计', () => {
    const markup = renderToStaticMarkup(
      createElement(DonutChart, {
        variant: 'pie',
        ariaLabel: '卡组图片饼图',
        data: [
          {
            id: 'deck-a',
            label: '卡组 A',
            value: 70,
            color: '#e95678',
            imageUrl: '/card/a.webp',
            imageCrop: 'live',
          },
          {
            id: 'deck-b',
            label: '卡组 B',
            value: 30,
            color: '#6fcbd0',
            imageUrl: '/card/b.webp',
          },
        ],
      })
    );

    expect(markup).toContain('<clipPath');
    expect(markup).toContain('href="/card/a.webp"');
    expect(markup).toContain('donut-chart__pie-image--live');
    expect(markup).toContain('viewBox="28 1 70 70"');
    expect(markup).toContain('donut-chart__pie-image--portrait');
    expect(markup).toContain('viewBox="0 0 100 118"');
    expect(markup.match(/width="100" height="140" preserveAspectRatio="none"/g)).toHaveLength(2);
    expect(markup.match(/preserveAspectRatio="xMidYMid slice"/g)).toHaveLength(2);
    expect(markup.match(/preserveAspectRatio="none"/g)).toHaveLength(2);
    expect(markup).not.toContain('opacity="0.08"');
    expect(markup.match(/donut-chart__pie-segment/g)).toHaveLength(2);
    expect(markup).not.toContain('donut-chart__center-value');
    expect(markup).not.toContain('stroke-dasharray');
  });
});
