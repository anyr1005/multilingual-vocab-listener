import { describe, expect, it } from 'vitest';
import { matchingVoices } from '../src/logic/speech.js';

describe('음성 고르기', () => {
  const voices = [
    { lang: 'en-US', name: 'Samantha' },
    { lang: 'zh-TW', name: 'Meijia' },
    { lang: 'zh_CN', name: 'Tingting' },
    { lang: 'zh-CN', name: 'Lili' },
    { lang: 'zh', name: 'Generic' },
  ];
  it('정확히 일치하는 언어를 먼저, 같은 기본 언어를 뒤에 둔다', () => {
    expect(matchingVoices(voices, 'zh-CN').map(v => v.name)).toEqual(['Tingting', 'Lili', 'Meijia', 'Generic']);
  });
  it('다른 언어의 음성은 넣지 않는다', () => {
    expect(matchingVoices(voices, 'ja-JP')).toEqual([]);
  });
});
