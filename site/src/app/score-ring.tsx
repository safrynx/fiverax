/** Score out of 100 as a ring (server or client component: no state). Same tiers as the Scanner. */
export const scoreTier = (score: number) => (score >= 80 ? ["Bon", "var(--ok)"] : score >= 50 ? ["À améliorer", "var(--warn)"] : ["Risqué", "var(--bad)"]) as [string, string];

export default function ScoreRing({ score, size = 150, caption }: { score: number; size?: number; caption?: string }) {
  const [label, color] = scoreTier(score);
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="audit-ring">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`Score ${score} sur 100`}>
        <circle cx={60} cy={60} r={r} fill="none" stroke="var(--line-2)" strokeWidth={9} />
        <circle cx={60} cy={60} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
        <text x={60} y={60} textAnchor="middle" dominantBaseline="central" className="audit-ring-num">{score}</text>
        <text x={60} y={86} textAnchor="middle" className="audit-ring-sub">/ 100</text>
      </svg>
      <b style={{ color }}>{caption ?? label}</b>
    </div>
  );
}
