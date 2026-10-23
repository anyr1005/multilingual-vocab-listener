/**
 * 같은 개념을 여러 언어로 따로 학습하므로 암기 기록은 `개념ID|학습언어`로 구분합니다.
 *
 * v1 중국어 전용 단어장은 개념ID만으로 기록을 저장했습니다. 그 기록이 사라지지 않도록
 * 중국어를 학습할 때는 옛 키를 읽어 주고, 새로 표시하는 순간 새 키로 옮깁니다.
 * localStorage를 직접 만지지 않아 노드에서 그대로 테스트할 수 있습니다.
 */
export type Familiarity = 'known' | 'unknown';
export type Progress = Record<string, Familiarity>;

/** v1 기록이 중국어 전용이었으므로 이 언어에서만 옛 키를 인정합니다. */
export const LEGACY_LANGUAGE = 'zh-CN';

export const progressKey = (id: string, target: string): string => `${id}|${target}`;

export function readProgress(
  progress: Progress, id: string, target: string,
): Familiarity | undefined {
  return progress[progressKey(id, target)]
    ?? (target === LEGACY_LANGUAGE ? progress[id] : undefined);
}

/**
 * 같은 값을 다시 표시하면 해제합니다. 호출자가 토글을 따로 계산하지 않도록 여기서 처리합니다.
 * 입력을 수정하지 않고 새 객체를 돌려줍니다.
 */
export function toggleProgress(
  progress: Progress, id: string, target: string, value: Familiarity,
): Progress {
  const next = { ...progress };
  const key = progressKey(id, target);
  if (readProgress(progress, id, target) === value) delete next[key];
  else next[key] = value;
  // 옛 키가 남아 있으면 새 키와 충돌하므로 이 시점에 정리합니다.
  if (target === LEGACY_LANGUAGE) delete next[id];
  return next;
}

/** 저장된 값 중 형식이 맞는 것만 남깁니다. */
export function sanitizeProgress(value: unknown): Progress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, state]) =>
    id.length > 0 && (state === 'known' || state === 'unknown'))) as Progress;
}
