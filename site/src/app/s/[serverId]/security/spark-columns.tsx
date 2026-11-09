/**
 * A stat tile's trend: one column per day, past days in the de-emphasis tone, today in the accent (single series:
 * no legend, the tile's label names it). Columns ≤ 24 px, 4 px rounded top, square at the baseline, 2 px gap.
 * Each column carries its day and value on hover (<title>) and the whole chart lists them for screen readers.
 */
export default function SparkColumns({ values, labels, unit }: { values: number[]; labels: string[]; unit: string }) {
  const width = 168;
  const height = 44;
  const gap = 2;
  const slot = width / values.length;
  const bar = Math.min(24, slot - gap);
  const max = Math.max(1, ...values);
  const summary = values.map((v, i) => `${labels[i]} : ${v}`).join(", ");
  return (
    <svg className="sc-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${unit} par jour. ${summary}`}>
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="sc-spark-base" />
      {values.map((v, i) => {
        const h = v === 0 ? 0 : Math.max(3, (v / max) * (height - 4));
        const x = i * slot + (slot - bar) / 2;
        const y = height - h;
        const r = Math.min(4, h, bar / 2);
        // Rounded top, square bottom.
        const d = h === 0 ? "" : `M${x},${height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bar - r},${y} Q${x + bar},${y} ${x + bar},${y + r} L${x + bar},${height} Z`;
        return (
          <g key={i} className="sc-spark-col" data-today={i === values.length - 1}>
            <rect x={i * slot} y={0} width={slot} height={height} fill="transparent"><title>{`${labels[i]} · ${v} ${unit}`}</title></rect>
            {d && <path d={d} />}
          </g>
        );
      })}
    </svg>
  );
}
