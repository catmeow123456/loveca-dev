import { useId } from 'react';
import './donut-chart.css';

const VIEW_BOX_SIZE = 120;
const CHART_CENTER = VIEW_BOX_SIZE / 2;
const CHART_RADIUS = 46;
const PIE_RADIUS = 52;
const CARD_IMAGE_VIEW_BOXES = {
  portrait: { width: 100, height: 140 },
  live: { width: 100, height: 140 },
} as const;
// These are source-image view boxes rather than positions on the chart. The image service delivers
// both types on a 5:7 portrait canvas. LIVE source cards are rotated clockwise from their original
// landscape layout, placing artwork at the upper-right, effect text on the left, and score/hearts
// below the artwork.
const PIE_ART_CROPS = {
  portrait: { x: 0, y: 0, width: 100, height: 118 },
  live: { x: 28, y: 1, width: 70, height: 70 },
} as const;

const defaultNumberFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
});

const percentageFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 1,
});

export interface DonutChartItem {
  id: string;
  label: string;
  value: number;
  color: string;
  imageUrl?: string;
  imageCrop?: keyof typeof PIE_ART_CROPS;
}

export interface DonutChartProps {
  data: readonly DonutChartItem[];
  title?: string;
  ariaLabel?: string;
  className?: string;
  centerLabel?: string;
  emptyLabel?: string;
  legendLabel?: string;
  showLegend?: boolean;
  showNormalizedPercentage?: boolean;
  variant?: 'donut' | 'pie';
  formatValue?: (value: number) => string;
}

interface RenderableDonutChartItem extends DonutChartItem {
  percentage: number;
  offset: number;
}

/**
 * Responsive, dependency-free donut chart primitive.
 *
 * Data ranking and visual aggregation intentionally remain the caller's responsibility so this
 * component can render the same prepared series in player and operator surfaces.
 */
export function DonutChart({
  data,
  title,
  ariaLabel,
  className,
  centerLabel = '总计',
  emptyLabel = '暂无可展示的数据',
  legendLabel,
  showLegend = true,
  showNormalizedPercentage = true,
  variant = 'donut',
  formatValue = (value) => defaultNumberFormatter.format(value),
}: DonutChartProps) {
  const titleId = useId();
  const descriptionId = useId();
  const clipIdPrefix = useId().replace(/:/g, '');
  const accessibleName =
    ariaLabel?.trim() || title?.trim() || (variant === 'pie' ? '饼图' : '环形图');
  const validData = data.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const total = validData.reduce((sum, item) => sum + item.value, 0);
  const renderableData = buildRenderableData(validData, total);
  const rootClassName = ['donut-chart', className].filter(Boolean).join(' ');

  return (
    <figure className={rootClassName}>
      {title ? <figcaption className="donut-chart__title">{title}</figcaption> : null}

      {renderableData.length === 0 ? (
        <div className="donut-chart__empty" role="status" aria-label={accessibleName}>
          {emptyLabel}
        </div>
      ) : (
        <div className="donut-chart__body">
          <div className="donut-chart__plot">
            <svg
              className="donut-chart__svg"
              viewBox={`0 0 ${VIEW_BOX_SIZE} ${VIEW_BOX_SIZE}`}
              role="img"
              aria-label={accessibleName}
              aria-describedby={descriptionId}
            >
              <title id={titleId}>{accessibleName}</title>
              <desc id={descriptionId}>
                {buildChartDescription(renderableData, total, formatValue)}
              </desc>
              {variant === 'pie' ? (
                <>
                  <defs>
                    {renderableData.map((item, index) => (
                      <clipPath key={item.id} id={`${clipIdPrefix}-slice-${index}`}>
                        <path d={buildPieSlicePath(item.offset, item.percentage)} />
                      </clipPath>
                    ))}
                  </defs>
                  <circle
                    className="donut-chart__pie-track"
                    cx={CHART_CENTER}
                    cy={CHART_CENTER}
                    r={PIE_RADIUS}
                  />
                  {renderableData.map((item, index) => (
                    <g key={item.id} className="donut-chart__pie-segment" aria-hidden="true">
                      <g clipPath={`url(#${clipIdPrefix}-slice-${index})`}>
                        <rect x="8" y="8" width="104" height="104" fill={item.color} />
                        {item.imageUrl
                          ? (() => {
                              const imageCrop = item.imageCrop ?? 'portrait';
                              const crop = PIE_ART_CROPS[imageCrop];
                              const sourceViewBox = CARD_IMAGE_VIEW_BOXES[imageCrop];
                              const frame = buildPieSliceBounds(item.offset, item.percentage);
                              return (
                                <svg
                                  className={`donut-chart__pie-image donut-chart__pie-image--${imageCrop}`}
                                  x={frame.x}
                                  y={frame.y}
                                  width={frame.width}
                                  height={frame.height}
                                  viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
                                  preserveAspectRatio="xMidYMid slice"
                                  overflow="hidden"
                                >
                                  <image
                                    href={item.imageUrl}
                                    x="0"
                                    y="0"
                                    width={sourceViewBox.width}
                                    height={sourceViewBox.height}
                                    preserveAspectRatio="none"
                                  />
                                </svg>
                              );
                            })()
                          : null}
                      </g>
                      <path
                        className="donut-chart__pie-boundary"
                        d={buildPieSlicePath(item.offset, item.percentage)}
                      />
                    </g>
                  ))}
                  <circle
                    className="donut-chart__pie-outline"
                    cx={CHART_CENTER}
                    cy={CHART_CENTER}
                    r={PIE_RADIUS}
                  />
                </>
              ) : (
                <>
                  <circle
                    className="donut-chart__track"
                    cx={CHART_CENTER}
                    cy={CHART_CENTER}
                    r={CHART_RADIUS}
                    pathLength={100}
                  />
                  {renderableData.map((item) => (
                    <circle
                      key={item.id}
                      className="donut-chart__segment"
                      cx={CHART_CENTER}
                      cy={CHART_CENTER}
                      r={CHART_RADIUS}
                      pathLength={100}
                      stroke={item.color}
                      strokeDasharray={`${item.percentage} ${100 - item.percentage}`}
                      strokeDashoffset={-item.offset}
                      aria-hidden="true"
                    />
                  ))}
                  <text className="donut-chart__center-value" x={CHART_CENTER} y={CHART_CENTER - 2}>
                    {formatValue(total)}
                  </text>
                  <text
                    className="donut-chart__center-label"
                    x={CHART_CENTER}
                    y={CHART_CENTER + 13}
                  >
                    {centerLabel}
                  </text>
                </>
              )}
            </svg>
          </div>

          {showLegend ? (
            <ul
              className="donut-chart__legend"
              aria-label={legendLabel?.trim() || `${accessibleName}图例`}
            >
              {renderableData.map((item) => (
                <li className="donut-chart__legend-item" key={item.id}>
                  <span
                    className="donut-chart__legend-swatch"
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                  <span className="donut-chart__legend-label">{item.label}</span>
                  <span className="donut-chart__legend-metric">
                    <span>{formatValue(item.value)}</span>
                    {showNormalizedPercentage ? (
                      <span className="donut-chart__legend-percentage">
                        {formatPercentage(item.percentage)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </figure>
  );
}

function buildRenderableData(
  data: readonly DonutChartItem[],
  total: number
): RenderableDonutChartItem[] {
  let offset = 0;
  return data.map((item) => {
    const percentage = (item.value / total) * 100;
    const renderableItem = { ...item, percentage, offset };
    offset += percentage;
    return renderableItem;
  });
}

function buildPieSlicePath(offsetPercentage: number, percentage: number): string {
  if (percentage >= 99.999) {
    return `M ${CHART_CENTER} ${CHART_CENTER} L ${CHART_CENTER} ${CHART_CENTER - PIE_RADIUS} A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${CHART_CENTER} ${CHART_CENTER + PIE_RADIUS} A ${PIE_RADIUS} ${PIE_RADIUS} 0 1 1 ${CHART_CENTER} ${CHART_CENTER - PIE_RADIUS} Z`;
  }
  const startAngle = -90 + (offsetPercentage / 100) * 360;
  const endAngle = startAngle + (percentage / 100) * 360;
  const start = pointOnCircle(startAngle);
  const end = pointOnCircle(endAngle);
  return `M ${CHART_CENTER} ${CHART_CENTER} L ${start.x} ${start.y} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${percentage > 50 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
}

function buildPieSliceBounds(
  offsetPercentage: number,
  percentage: number
): { x: number; y: number; width: number; height: number } {
  if (percentage >= 99.999) {
    return {
      x: CHART_CENTER - PIE_RADIUS,
      y: CHART_CENTER - PIE_RADIUS,
      width: PIE_RADIUS * 2,
      height: PIE_RADIUS * 2,
    };
  }

  const startAngle = -90 + (offsetPercentage / 100) * 360;
  const endAngle = startAngle + (percentage / 100) * 360;
  const points = [
    { x: CHART_CENTER, y: CHART_CENTER },
    pointOnCircle(startAngle),
    pointOnCircle(endAngle),
  ];

  // Include every cardinal point crossed by the arc so the rectangular image frame encloses the
  // complete sector instead of only its two endpoints.
  for (
    let cardinalAngle = Math.ceil(startAngle / 90) * 90;
    cardinalAngle < endAngle;
    cardinalAngle += 90
  ) {
    if (cardinalAngle > startAngle) {
      points.push(pointOnCircle(cardinalAngle));
    }
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: roundCoordinate(minX),
    y: roundCoordinate(minY),
    width: Math.max(0.001, roundCoordinate(maxX - minX)),
    height: Math.max(0.001, roundCoordinate(maxY - minY)),
  };
}

function pointOnCircle(angleInDegrees: number): { x: number; y: number } {
  const radians = (angleInDegrees * Math.PI) / 180;
  return {
    x: roundCoordinate(CHART_CENTER + PIE_RADIUS * Math.cos(radians)),
    y: roundCoordinate(CHART_CENTER + PIE_RADIUS * Math.sin(radians)),
  };
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildChartDescription(
  data: readonly RenderableDonutChartItem[],
  total: number,
  formatValue: (value: number) => string
): string {
  const items = data
    .map(
      (item) => `${item.label}：${formatValue(item.value)}，占 ${formatPercentage(item.percentage)}`
    )
    .join('；');
  return `总计 ${formatValue(total)}。${items}。`;
}

function formatPercentage(percentage: number): string {
  if (percentage > 0 && percentage < 0.1) {
    return '<0.1%';
  }
  return `${percentageFormatter.format(percentage)}%`;
}
