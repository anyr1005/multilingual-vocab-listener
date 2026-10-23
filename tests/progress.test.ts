import { describe, expect, it } from 'vitest';
import { progressKey, readProgress, sanitizeProgress, toggleProgress,
  type Progress } from '../src/logic/progress.js';

describe('언어별 암기 기록과 v1 이행', () => {
  it('같은 개념이라도 학습 언어마다 따로 기록된다', () => {
    const progress = toggleProgress({}, 'apple', 'zh-CN', 'known');
    expect(readProgress(progress, 'apple', 'zh-CN')).toBe('known');
    expect(readProgress(progress, 'apple', 'en-US')).toBeUndefined();
  });
  it('v1 중국어 기록(개념ID만 있는 키)을 중국어 학습에서 그대로 읽는다', () => {
    const legacy: Progress = { apple: 'known' };
    expect(readProgress(legacy, 'apple', 'zh-CN')).toBe('known');
  });
  it('v1 기록을 다른 언어 학습에 끌어쓰지 않는다', () => {
    const legacy: Progress = { apple: 'known' };
    expect(readProgress(legacy, 'apple', 'en-US')).toBeUndefined();
    expect(readProgress(legacy, 'apple', 'ja-JP')).toBeUndefined();
  });
  it('중국어를 새로 표시하면 v1 키를 새 키로 옮긴다', () => {
    const next = toggleProgress({ apple: 'known' }, 'apple', 'zh-CN', 'unknown');
    expect(next).toEqual({ [progressKey('apple', 'zh-CN')]: 'unknown' });
    expect(next.apple).toBeUndefined();
  });
  it('같은 값을 다시 누르면 해제되고, v1 키도 함께 사라진다', () => {
    const next = toggleProgress({ apple: 'known' }, 'apple', 'zh-CN', 'known');
    expect(next).toEqual({});
  });
  it('입력 객체를 변형하지 않는다', () => {
    const before: Progress = { apple: 'known' };
    toggleProgress(before, 'apple', 'zh-CN', 'unknown');
    expect(before).toEqual({ apple: 'known' });
  });
  it('저장된 값 중 형식이 맞지 않는 것은 버린다', () => {
    expect(sanitizeProgress({ a: 'known', b: 'maybe', '': 'known', c: 'unknown' }))
      .toEqual({ a: 'known', c: 'unknown' });
    expect(sanitizeProgress(['known'])).toEqual({});
    expect(sanitizeProgress(null)).toEqual({});
  });
});
