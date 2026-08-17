import { chartTier, type SeriesPoint } from '../engine/battery';

/**
 * Hand-rolled inline SVG. No charting library — a dependency for eight points
 * and a polyline would cost more bundle than the entire engine layer.
 *
 * Chrome scales with the data: two points get a line and nothing else, because
 * axis labels over three results imply a precision the data does not have.
 */

interface SparklineProps {
  series: SeriesPoint[];
  color: string;
  width?: number;
  height?: number;
}

function scale(
  series: SeriesPoint[], width: number, height: number, pad: number,
): { points: string; coords: Array<[number, number]>; min: number; max: number } {
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; centre it instead.
  const span = max - min || 1;
  const stepX = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;

  const coords = series.map((p, i): [number, number] => [
    pad + i * stepX,
    height - pad - ((p.value - min) / span) * (height - pad * 2),
  ]);

  return {
    points: coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    coords,
    min,
    max,
  };
}

/** 40×16, last 8 results, no axes. */
export function Sparkline({ series, color, width = 40, height = 16 }: SparklineProps) {
  const recent = series.slice(-8);
  if (chartTier(recent.length) === 'none' || recent.length < 2) return null;

  const { points } = scale(recent, width, height, 2);

  return (
    <svg
      class="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      data-testid="sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
}

interface DetailChartProps {
  series: SeriesPoint[];
  color: string;
  unit: string;
  label?: string;
}

/**
 * Full-width detail chart, ~200px tall.
 *
 * Transparent background, no gridlines, no legend — the same discipline as the
 * ledger. Y axis shows min and max only; X shows first and last date only.
 */
export function DetailChart({ series, color, unit, label }: DetailChartProps) {
  const tier = chartTier(series.length);

  if (tier === 'none') {
    return <p class="chart__empty" data-testid="chart-empty">NO RESULTS</p>;
  }

  if (tier === 'value') {
    const only = series[0];
    return (
      <p class="chart__single num" data-testid="chart-single">
        {only?.value} {unit}
      </p>
    );
  }

  const width = 320;
  const height = 200;
  const pad = 22;
  const { points, coords, min, max } = scale(series, width, height, pad);
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <figure class="chart" data-testid="detail-chart" data-tier={tier}>
      {label && <figcaption class="chart__label">{label}</figcaption>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        class="chart__svg"
        role="img"
        aria-label={`${label ?? 'Result'} trend, ${series.length} results`}
      >
        <polyline
          points={points}
          fill="none"
          stroke={color}
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        {coords.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4" fill={color} />
        ))}
      </svg>

      {/* Axis labels only exist at the full tier: 2–3 points get the line alone. */}
      {tier === 'full' && (
        <div class="chart__axes num" data-testid="chart-axes">
          <span class="chart__y">{max} / {min} {unit}</span>
          <span class="chart__x">
            {first?.localDate} → {last?.localDate}
          </span>
        </div>
      )}
    </figure>
  );
}
