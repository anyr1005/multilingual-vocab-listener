import { BASE_LANGUAGE, getTerm, languageName, languageNames, speechTextOf, targetLanguages, wordSearchText,
  type Vocabulary, type WordPayload } from './domain/words.js';
import { fetchScripts, fetchWords } from './logic/data.js';
import { orderByKeys, shuffleKeys } from './logic/order.js';
import { dom, input, keepScreenAwake, registerServiceWorker, releaseScreen, restoreScreenWake, select } from './logic/page.js';
import { buildSegments, normalizeSettings } from './logic/playlist.js';
import { SpeechPlayer, sleep } from './logic/speech.js';
import { chooseVoice, fillVoiceSelect } from './logic/voicePicker.js';
import { loadLastConceptId, loadProgress, loadSettings, loadTargetLanguage, loadVoicePreferences, readProgress, saveLastConceptId,
  saveProgress, saveSettings, saveTargetLanguage, toggleProgress, type Familiarity } from './logic/storage.js';

type Mode = 'card' | 'listen';
type Scope = 'all' | 'known' | 'unknown' | 'unmarked';
const speech = new SpeechPlayer();
const state = {
  payload: null as WordPayload | null,
  words: [] as Vocabulary[],
  visible: [] as Vocabulary[],
  targetLanguage: loadTargetLanguage() ?? '',
  currentIndex: 0,
  revealed: false,
  mode: 'card' as Mode,
  shuffled: false,
  settings: loadSettings(),
  progress: loadProgress(),
  controller: null as AbortController | null,
  listLimit: 60,
  lastLoadedAt: 0,
  // 언어별로 고른 음성. 스크립트 페이지와 같은 저장값을 씁니다.
  voices: loadVoicePreferences(),
  shuffleOrder: new Map<string, number>(),
  languageNames: new Map<string, string>(),
  // 앱을 다시 열면 마지막으로 보던 개념부터 이어서 시작합니다.
  restoreConceptId: loadLastConceptId(),
};
speech.setPreferredVoices(state.voices);
let savedConceptId: string | null = null;
const status = (message: string): void => { dom('status').textContent = message; };
/** 같은 언어의 다른 지역이 함께 있을 때만 지역이 붙은 이름을 씁니다. */
const nameOf = (code: string): string => state.languageNames.get(code) ?? languageName(code);
const current = (): Vocabulary | undefined => state.visible[state.currentIndex];
function progressOf(word: Vocabulary): Familiarity | undefined {
  return readProgress(state.progress, word.id, state.targetLanguage);
}
function stopPlayback(): void {
  state.controller?.abort();
  state.controller = null;
  speech.cancel();
  releaseScreen();
  dom<HTMLButtonElement>('stop').disabled = true;
  dom<HTMLButtonElement>('play').textContent = '▶ 현재 단어부터 재생';
}
function rememberCurrent(word: Vocabulary | undefined): void {
  if (!word || word.id === savedConceptId) return;
  savedConceptId = word.id;
  saveLastConceptId(word.id);
}
function populate(id: string, values: string[]): void {
  const element = select(id);
  const previous = element.value;
  element.replaceChildren(new Option('전체', 'all'));
  [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ko'))
    .forEach(item => element.add(new Option(item, item)));
  if (values.includes(previous)) element.value = previous;
}
function refreshLanguages(): void {
  const languages = targetLanguages(state.words);
  state.languageNames = languageNames([BASE_LANGUAGE, ...languages]);
  const element = select('targetLanguage');
  element.replaceChildren(...languages.map(code => new Option(nameOf(code), code)));
  if (!languages.includes(state.targetLanguage)) state.targetLanguage = languages[0] ?? '';
  element.value = state.targetLanguage;
  saveTargetLanguage(state.targetLanguage);
  const name = nameOf(state.targetLanguage);
  dom('targetRepeatLabel').textContent = `${name} 반복`;
  dom('targetDisplayLabel').textContent = name;
  dom('pronunciationDisplayLabel').textContent = `${name} 발음 표기`;
  dom('targetOnlyLabel').textContent = `${name}만`;
  dom('targetFirstLabel').textContent = `${name} → 한국어`;
  dom('koreanFirstLabel').textContent = `한국어 → ${name}`;
  dom('targetVoiceLabel').textContent = `${name} 음성`;
  void refreshVoices();
}
/** 학습 언어와 한국어 각각 기기에 있는 음성 중에서 고릅니다. */
async function refreshVoices(): Promise<void> {
  const target = select('targetVoice');
  target.closest('label')!.hidden = !state.targetLanguage;
  await Promise.all([
    state.targetLanguage ? fillVoiceSelect(target, speech, state.targetLanguage, state.voices) : undefined,
    fillVoiceSelect(select('koreanVoice'), speech, BASE_LANGUAGE, state.voices),
  ]);
}
function changeVoice(element: HTMLSelectElement): void {
  state.voices = chooseVoice(element, speech, state.voices);
  const language = element.dataset.language;
  const term = current() && language ? getTerm(current()!, language) : undefined;
  if (state.controller || !term) return;
  // 재생 중이 아니면 지금 카드의 단어를 한 번 읽어 바로 비교해 볼 수 있게 합니다.
  speech.cancel();
  void speech.speak(speechTextOf(term), language!, state.settings.rate, new AbortController().signal)
    .catch(() => undefined);
}
function refreshGroups(): void {
  populate('group', state.words.filter(w => getTerm(w, state.targetLanguage)).map(w => w.group));
  refreshSubs();
}
function refreshSubs(): void {
  const group = select('group').value;
  populate('sub', state.words.filter(w => getTerm(w, state.targetLanguage) && (group === 'all' || w.group === group)).map(w => w.sub));
}
function applyFilters(): void {
  stopPlayback();
  const query = input('search').value.trim().toLocaleLowerCase();
  const group = select('group').value;
  const sub = select('sub').value;
  const scope = select('scope').value as Scope;
  state.visible = state.words.filter(word => {
    const familiarity = progressOf(word);
    return Boolean(getTerm(word, state.targetLanguage))
      && (group === 'all' || word.group === group)
      && (sub === 'all' || word.sub === sub)
      && (!query || wordSearchText(word).includes(query))
      && (scope === 'all' || (scope === 'unmarked' ? !familiarity : familiarity === scope));
  });
  if (state.shuffled) state.visible = orderByKeys(state.visible, state.shuffleOrder);
  // 복원은 앱을 연 직후 한 번만. 이후의 필터 변경은 평소처럼 첫 단어로 돌아갑니다.
  const restoreAt = state.restoreConceptId
    ? state.visible.findIndex(word => word.id === state.restoreConceptId) : -1;
  state.restoreConceptId = null;
  state.currentIndex = restoreAt > 0 ? restoreAt : 0;
  state.revealed = false;
  state.listLimit = 60;
  render();
}
function showOtherTranslations(word: Vocabulary | undefined, revealed: boolean): void {
  const container = dom('otherTranslations');
  container.replaceChildren();
  const allow = state.mode !== 'listen' || state.settings.showOtherLanguages;
  if (!word || !revealed || !allow) { container.hidden = true; return; }
  const languages = Object.keys(word.terms).filter(code => code !== BASE_LANGUAGE && code !== state.targetLanguage);
  if (!languages.length) { container.hidden = true; return; }
  container.hidden = false;
  const caption = document.createElement('small');
  caption.textContent = '같은 의미의 다른 언어 표현';
  container.append(caption);
  for (const language of languages) {
    const term = getTerm(word, language)!;
    const row = document.createElement('span'); row.className = 'other-term';
    const label = document.createElement('strong'); label.textContent = `${nameOf(language)}  `;
    const text = document.createElement('span'); text.textContent = term.text; text.lang = language;
    row.append(label, text);
    if (term.pronunciation) {
      const pronunciation = document.createElement('em');
      pronunciation.textContent = `  ${term.pronunciation}`;
      row.append(pronunciation);
    }
    container.append(row);
  }
}
function render(): void {
  const word = current();
  const target = word ? getTerm(word, state.targetLanguage) : undefined;
  const korean = word ? getTerm(word, BASE_LANGUAGE) : undefined;
  dom('count').textContent = `${state.visible.length} / ${state.words.filter(w => getTerm(w, state.targetLanguage)).length}개`;
  const known = state.words.filter(w => getTerm(w, state.targetLanguage) && progressOf(w) === 'known').length;
  const unknown = state.words.filter(w => getTerm(w, state.targetLanguage) && progressOf(w) === 'unknown').length;
  dom('progress').textContent = `암기 ${known} · 모름 ${unknown}`;
  const listening = state.mode === 'listen';
  const allowKorean = !listening || state.settings.showKorean;
  const allowTarget = !listening || state.settings.showTarget;
  const allowPronunciation = !listening || state.settings.showPronunciation;
  dom('front').textContent = !word ? '조건에 맞는 단어가 없어요'
    : allowKorean ? korean?.text ?? '' : '···';
  dom('cardHint').textContent = word
    ? `${state.currentIndex + 1} / ${state.visible.length} · ${word.group} / ${word.sub} · ${nameOf(state.targetLanguage)}`
    : '언어, 검색 또는 분류를 변경해 보세요';
  const answer = dom('answer');
  answer.hidden = !word || !state.revealed;
  const back = dom('back');
  back.hidden = !allowTarget;
  back.textContent = target?.text ?? '';
  back.lang = state.targetLanguage;
  const pronunciation = dom('pronunciation');
  pronunciation.hidden = !allowPronunciation || !target?.pronunciation;
  pronunciation.textContent = target?.pronunciation ?? '';
  const example = dom('example');
  example.textContent = target?.example ?? '';
  example.lang = state.targetLanguage;
  example.hidden = !allowTarget || !target?.example;
  const exampleTranslation = dom('exampleTranslation');
  exampleTranslation.textContent = target?.exampleTranslation ?? '';
  exampleTranslation.hidden = !allowKorean || !target?.exampleTranslation;
  const note = dom('note'); note.textContent = word?.note ?? ''; note.hidden = !word?.note;
  showOtherTranslations(word, Boolean(word && state.revealed));
  dom('tapHint').textContent = !word ? ''
    : listening ? '표현과 발음을 연결해 보세요'
      : state.revealed ? '눌러서 정답 숨기기' : '눌러서 정답 보기';
  for (const id of ['prev', 'next', 'speakOne', 'markKnown', 'markUnknown', 'play']) {
    dom<HTMLButtonElement>(id).disabled = !word;
  }
  dom<HTMLButtonElement>('markKnown').setAttribute('aria-pressed', String(Boolean(word && progressOf(word) === 'known')));
  dom<HTMLButtonElement>('markUnknown').setAttribute('aria-pressed', String(Boolean(word && progressOf(word) === 'unknown')));
  rememberCurrent(word);
  renderList();
}
function renderList(): void {
  const container = dom('wordList');
  const fragment = document.createDocumentFragment();
  for (const [index, word] of state.visible.slice(0, state.listLimit).entries()) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `word-row${index === state.currentIndex ? ' selected' : ''}`;
    button.setAttribute('aria-current', index === state.currentIndex ? 'true' : 'false');
    const left = document.createElement('span'); left.className = 'word-row-left';
    const title = document.createElement('strong'); title.textContent = getTerm(word, BASE_LANGUAGE)?.text ?? '';
    const category = document.createElement('small'); category.textContent = `${word.group} · ${word.sub}`;
    left.append(title, category);
    const right = document.createElement('span'); right.className = 'word-row-right';
    const translated = document.createElement('span'); translated.lang = state.targetLanguage;
    translated.textContent = getTerm(word, state.targetLanguage)?.text ?? '';
    const flag = document.createElement('span'); flag.className = 'flag';
    flag.textContent = progressOf(word) === 'known' ? '✓' : progressOf(word) === 'unknown' ? '☆' : '';
    right.append(translated, flag); button.append(left, right);
    button.addEventListener('click', () => {
      stopPlayback(); state.currentIndex = index; state.revealed = true; render();
      dom('flashcard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    fragment.append(button);
  }
  container.replaceChildren(fragment);
  const more = dom<HTMLButtonElement>('moreWords');
  more.hidden = state.visible.length <= state.listLimit;
  more.textContent = `더 보기 (${state.visible.length - state.listLimit}개 남음)`;
}
function move(direction: number): void {
  if (!state.visible.length) return;
  stopPlayback();
  state.currentIndex = (state.currentIndex + direction + state.visible.length) % state.visible.length;
  state.revealed = false;
  render();
}
function mark(familiarity: Familiarity): void {
  const word = current(); if (!word) return;
  state.progress = toggleProgress(state.progress, word.id, state.targetLanguage, familiarity);
  if (!saveProgress(state.progress)) status('저장 공간 때문에 복습 기록을 저장하지 못했어요.');
  if (select('scope').value === 'all') render(); else applyFilters();
}
function setMode(mode: Mode): void {
  stopPlayback(); state.mode = mode; state.revealed = mode === 'listen';
  dom('listenSettings').hidden = mode !== 'listen';
  for (const [id, value] of [['tabCard', 'card'], ['tabListen', 'listen']] as const) {
    dom<HTMLButtonElement>(id).classList.toggle('active', mode === value);
    dom<HTMLButtonElement>(id).setAttribute('aria-pressed', String(mode === value));
  }
  render();
}
/**
 * 스크립트 듣기는 별도 페이지(script/)입니다. 선택 기능이라 스크립트가 있을 때만 링크를 보여 주고,
 * 실패해도 단어 학습을 막지 않습니다.
 */
async function refreshScriptLink(): Promise<void> {
  const payload = await fetchScripts().catch(() => null);
  dom('scriptLink').hidden = !payload?.scripts.length;
}
function updateSettings(): void {
  state.settings = normalizeSettings({
    order: select('order').value,
    koreanRepeats: Number(select('repeatKo').value),
    targetRepeats: Number(select('repeatTarget').value),
    otherRepeats: Number(select('repeatOther').value),
    thoughtDelayMs: Number(select('thoughtDelay').value),
    wordDelayMs: Number(select('wordDelay').value),
    rate: Number(input('rate').value),
    showKorean: input('showKorean').checked,
    showTarget: input('showTarget').checked,
    showPronunciation: input('showPronunciation').checked,
    showOtherLanguages: input('showOtherLanguages').checked,
  });
  saveSettings(state.settings);
  dom('rateValue').textContent = `${state.settings.rate.toFixed(1)}×`;
  if (state.mode === 'listen') render();
}
function restoreSettings(): void {
  const s = state.settings;
  select('order').value = s.order;
  select('repeatKo').value = String(s.koreanRepeats);
  select('repeatTarget').value = String(s.targetRepeats);
  select('repeatOther').value = String(s.otherRepeats);
  select('thoughtDelay').value = String(s.thoughtDelayMs);
  select('wordDelay').value = String(s.wordDelayMs);
  input('rate').value = String(s.rate);
  input('showKorean').checked = s.showKorean;
  input('showTarget').checked = s.showTarget;
  input('showPronunciation').checked = s.showPronunciation;
  input('showOtherLanguages').checked = s.showOtherLanguages;
  dom('rateValue').textContent = `${s.rate.toFixed(1)}×`;
}
async function playOne(): Promise<void> {
  const target = current() ? getTerm(current()!, state.targetLanguage) : undefined;
  if (!target) return;
  stopPlayback();
  if (!speech.isSupported) { status('이 브라우저에서는 음성 합성을 지원하지 않습니다.'); return; }
  state.revealed = true; render();
  const controller = new AbortController(); state.controller = controller;
  try {
    status(`${nameOf(state.targetLanguage)} 발음 재생 중`);
    await speech.speak(speechTextOf(target), state.targetLanguage, state.settings.rate, controller.signal);
    if (!controller.signal.aborted) status('발음 재생 완료');
  } catch (error) {
    if (!controller.signal.aborted) status(error instanceof Error ? error.message : '발음 재생 실패');
  } finally { if (state.controller === controller) state.controller = null; }
}
async function playAll(): Promise<void> {
  if (!current()) return;
  if (!speech.isSupported) { status('이 브라우저에서는 음성 합성을 지원하지 않습니다.'); return; }
  stopPlayback();
  const items = state.visible.slice();
  const start = state.currentIndex;
  const settings = { ...state.settings };
  const targetLanguage = state.targetLanguage;
  if (!items.some(word => buildSegments(word, settings, targetLanguage).length)) {
    status('읽을 언어의 반복 횟수를 1회 이상으로 설정해 주세요.'); return;
  }
  const controller = new AbortController(); state.controller = controller;
  const { signal } = controller;
  dom<HTMLButtonElement>('stop').disabled = false;
  dom<HTMLButtonElement>('play').textContent = '↻ 처음부터 다시 재생';
  state.revealed = true;
  void keepScreenAwake();
  try {
    for (let index = start; index < items.length && !signal.aborted; index++) {
      const word = items[index]!;
      state.currentIndex = index; render();
      const segments = buildSegments(word, settings, targetLanguage);
      status(`재생 중 · ${index + 1} / ${items.length}`);
      for (const segment of segments) {
        if (signal.aborted) return;
        await speech.speak(segment.text, segment.language, settings.rate, signal);
        if (signal.aborted) return;
        await sleep(segment.waitAfterMs, signal);
      }
    }
    if (!signal.aborted) status('연속 듣기가 끝났어요.');
  } catch (error) {
    if (!signal.aborted) status(error instanceof Error ? error.message : '음성 재생 실패');
  } finally {
    if (state.controller === controller) {
      state.controller = null;
      releaseScreen();
      dom<HTMLButtonElement>('stop').disabled = true;
      dom<HTMLButtonElement>('play').textContent = '▶ 현재 단어부터 재생';
    }
  }
}
async function reloadWords(): Promise<void> {
  stopPlayback();
  void refreshScriptLink();
  dom<HTMLButtonElement>('refresh').disabled = true;
  dom('syncBadge').textContent = '확인 중';
  try {
    const { payload, fromCache, error } = await fetchWords();
    state.payload = payload; state.words = payload.words; state.lastLoadedAt = Date.now();
    // 새로 들어온 개념에도 정렬 키를 부여해야 목록 맨 앞으로 몰리지 않습니다.
    if (state.shuffled) state.shuffleOrder = shuffleKeys(payload.words.map(word => word.id));
    dom('syncBadge').textContent = fromCache ? '⚠ 저장된 데이터' : '✓ 최신 데이터';
    dom('dataSource').textContent = `${payload.words.length}개 개념 · ${payload.source === 'seed' ? '초기 샘플' : 'Notion'}`;
    dom('updatedAt').textContent = payload.updatedAt
      ? `생성: ${new Date(payload.updatedAt).toLocaleString('ko-KR')}` : '생성 시각 없음';
    refreshLanguages(); refreshGroups(); applyFilters();
    status(fromCache ? `이전 데이터를 표시합니다. (${error ?? '네트워크 오류'})` : '학습할 항목을 선택하세요.');
  } catch (error) {
    dom('syncBadge').textContent = '⚠ 불러오기 실패';
    status(`데이터를 불러오지 못했습니다. ${error instanceof Error ? error.message : ''}`);
  } finally { dom<HTMLButtonElement>('refresh').disabled = false; }
}
for (const id of ['sub', 'scope']) select(id).addEventListener('change', applyFilters);
select('group').addEventListener('change', () => { refreshSubs(); applyFilters(); });
select('targetLanguage').addEventListener('change', () => {
  state.targetLanguage = select('targetLanguage').value;
  saveTargetLanguage(state.targetLanguage); refreshLanguages(); refreshGroups(); applyFilters();
});
input('search').addEventListener('input', applyFilters);
dom('refresh').addEventListener('click', () => void reloadWords());
dom('flashcard').addEventListener('click', () => {
  if (!current() || state.mode === 'listen') return;
  state.revealed = !state.revealed; render();
});
dom('prev').addEventListener('click', () => move(-1));
dom('next').addEventListener('click', () => move(1));
dom('markKnown').addEventListener('click', () => mark('known'));
dom('markUnknown').addEventListener('click', () => mark('unknown'));
dom('speakOne').addEventListener('click', () => void playOne());
dom('tabCard').addEventListener('click', () => setMode('card'));
dom('tabListen').addEventListener('click', () => setMode('listen'));
dom('shuffle').addEventListener('click', () => {
  state.shuffled = !state.shuffled;
  // 켤 때만 새로 섞습니다. 이후 검색·분류를 바꿔도 남은 단어의 순서는 그대로입니다.
  if (state.shuffled) state.shuffleOrder = shuffleKeys(state.words.map(word => word.id));
  dom('shuffle').setAttribute('aria-pressed', String(state.shuffled));
  dom('shuffle').textContent = state.shuffled ? '⇄ 무작위 켜짐' : '⇄ 순서 섞기';
  applyFilters();
});
for (const id of ['order', 'repeatKo', 'repeatTarget', 'repeatOther', 'thoughtDelay', 'wordDelay']) {
  select(id).addEventListener('change', updateSettings);
}
for (const id of ['rate', 'showKorean', 'showTarget', 'showPronunciation', 'showOtherLanguages']) {
  input(id).addEventListener(id === 'rate' ? 'input' : 'change', updateSettings);
}
for (const id of ['targetVoice', 'koreanVoice']) select(id).addEventListener('change', () => changeVoice(select(id)));
speech.onVoicesChanged(() => void refreshVoices());
dom('play').addEventListener('click', () => void playAll());
dom('stop').addEventListener('click', () => { stopPlayback(); status('재생을 중지했어요.'); });
dom('moreWords').addEventListener('click', () => { state.listLimit += 60; renderList(); });
dom('resetProgress').addEventListener('click', () => {
  if (!window.confirm('이 기기에 저장된 모든 언어의 암기 기록을 삭제할까요?')) return;
  state.progress = {}; saveProgress(state.progress); applyFilters(); status('암기 기록을 초기화했어요.');
});
document.addEventListener('visibilitychange', () => {
  restoreScreenWake(Boolean(state.controller));
  if (document.hidden || state.controller || Date.now() - state.lastLoadedAt < 15 * 60 * 1000) return;
  void reloadWords();
});
registerServiceWorker();
restoreSettings();
void reloadWords();
