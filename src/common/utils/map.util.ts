type SelectValue = true | { select: Record<string, SelectValue> };

export function buildSelect<T extends string>(
  fields: readonly T[],
  relations?: Record<string, readonly string[]>,
): Record<string, SelectValue> {
  const select: Record<string, SelectValue> = {};
  for (const field of fields) {
    select[field] = true;
  }
  if (relations) {
    for (const [rel, relFields] of Object.entries(relations)) {
      select[rel] = { select: buildSelect(relFields) };
    }
  }
  return select;
}
