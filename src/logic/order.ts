/**
 * 학습 목록의 무작위 순서를 개념별 정렬 키로 고정합니다.
 * 검색어나 분류를 바꿀 때마다 다시 섞이면 순서가 눈앞에서 흔들리므로,
 * 키를 한 번만 만들어 두고 필터링된 목록에 같은 키를 적용합니다.
 */
export function shuffleKeys(
  ids: readonly string[],
  random: () => number = Math.random,
): Map<string, number> {
  return new Map(ids.map(id => [id, random()]));
}

/** 키가 없는 항목은 맨 앞에 두고, 키가 같으면 ID로 정렬해 순서를 결정적으로 만듭니다. */
export function orderByKeys<T extends { id: string }>(
  items: readonly T[],
  keys: ReadonlyMap<string, number>,
): T[] {
  return [...items].sort((a, b) =>
    (keys.get(a.id) ?? 0) - (keys.get(b.id) ?? 0) || a.id.localeCompare(b.id));
}
