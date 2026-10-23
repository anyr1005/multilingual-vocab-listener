import { describe, expect, it } from 'vitest';
import { orderByKeys, shuffleKeys } from '../src/logic/order.js';

const items = (...ids: string[]): { id: string }[] => ids.map(id => ({ id }));

describe('무작위 순서 고정', () => {
  it('필터로 일부가 빠져도 남은 항목의 상대 순서는 유지된다', () => {
    const keys = shuffleKeys(['a', 'b', 'c', 'd'], seq([0.9, 0.1, 0.5, 0.3]));
    const all = orderByKeys(items('a', 'b', 'c', 'd'), keys).map(item => item.id);
    expect(all).toEqual(['b', 'd', 'c', 'a']);
    // 검색으로 c가 빠져도 b → d → a 순서는 그대로여야 합니다.
    const filtered = orderByKeys(items('a', 'b', 'd'), keys).map(item => item.id);
    expect(filtered).toEqual(['b', 'd', 'a']);
  });
  it('같은 키 집합으로 여러 번 정렬해도 결과가 같다', () => {
    const keys = shuffleKeys(['a', 'b', 'c'], seq([0.2, 0.2, 0.2]));
    const once = orderByKeys(items('c', 'a', 'b'), keys).map(item => item.id);
    const twice = orderByKeys(items('b', 'c', 'a'), keys).map(item => item.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(['a', 'b', 'c']); // 키가 같으면 ID로 결정
  });
  it('키가 없는 새 개념도 정렬에서 빠지지 않는다', () => {
    const keys = shuffleKeys(['a'], seq([0.5]));
    expect(orderByKeys(items('a', 'new'), keys).map(item => item.id)).toEqual(['new', 'a']);
  });
  it('입력을 변형하지 않는다', () => {
    const source = items('b', 'a');
    orderByKeys(source, shuffleKeys(['a', 'b'], seq([0.1, 0.9])));
    expect(source.map(item => item.id)).toEqual(['b', 'a']);
  });
});

function seq(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}
