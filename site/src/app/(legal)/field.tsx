/** A known value, or a visible marker for what still has to be filled in (see src/lib/legal.ts). */
export function Field({ value }: { value: string | null }) {
  return value ? <>{value}</> : <em className="todo">à compléter</em>;
}
