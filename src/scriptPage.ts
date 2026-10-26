import type { Script } from './domain/scripts.js';
import { BASE_LANGUAGE, languageName, languageNames } from './domain/words.js';
import { fetchScripts } from './logic/data.js';
import { dom, input, keepScreenAwake, registerServiceWorker, releaseScreen, restoreScreenWake, select } from './logic/page.js';
import { buildScriptSegments, normalizeScriptSettings, sentenceCount } from './logic/scriptPlaylist.js';
import { SpeechPlayer, sleep } from './logic/speech.js';
import { loadScriptPosition, loadScriptSettings, saveScriptPosition, saveScriptSettings } from './logic/storage.js';

const speech = new SpeechPlayer();
const state = {
  scripts: [] as Script[],
  settings: loadScriptSettings(),
  // 스크립트는 끊긴 문장부터 이어 듣습니다. 다 들으면 처음(0)으로 돌아갑니다.
  position: loadScriptPosition(),
  controller: null as AbortController | null,
  lastLoadedAt: 0,
};
const status = (message: string): void => { dom('status').textContent = message; };
function stopPlayback(): void {
  state.controller?.abort();
  state.controller = null;
  speech.cancel();
  releaseScreen();
  dom<HTMLButtonElement>('scriptStop').disabled = true;
  dom<HTMLButtonElement>('scriptPlay').textContent = '▶ 이어서 재생';
}
const currentScript = (): Script | undefined =>
  state.scripts.find(script => script.id === state.position?.id) ?? state.scripts[0];
function setPosition(script: Script, sentence: number): void {
  state.position = { id: script.id, sentence };
  saveScriptPosition(state.position);
}
/** 언어별로 묶어 보여 줍니다. 한 스크립트는 한 언어로만 쓰여 있습니다. */
function refreshOptions(): void {
  const element = select('scriptSelect');
  const groups = new Map<string, Script[]>();
  for (const script of state.scripts) groups.set(script.language, [...groups.get(script.language) ?? [], script]);
  const names = languageNames([...groups.keys()]);
  element.replaceChildren(...[...groups].map(([language, scripts]) => {
    const group = document.createElement('optgroup');
    group.label = names.get(language) ?? languageName(language);
    group.append(...scripts.map(script => new Option(`${script.title} · ${script.group}`, script.id)));
    return group;
  }));
  element.value = currentScript()?.id ?? '';
  dom('scriptStudy').hidden = !state.scripts.length;
}
function render(): void {
  const script = currentScript();
  const container = dom('scriptText');
  const fragment = document.createDocumentFragment();
  let index = 0;
  for (const paragraph of script?.paragraphs ?? []) {
    const block = document.createElement(paragraph.kind === 'heading' ? 'h3' : 'p');
    block.className = `script-paragraph${paragraph.kind === 'heading' ? ' script-heading' : ''}`;
    const original = document.createElement('span');
    original.lang = script!.language;
    for (const text of paragraph.sentences) {
      const sentence = document.createElement('span');
      sentence.className = 'sentence';
      sentence.textContent = text;
      sentence.dataset.sentence = String(index++);
      sentence.tabIndex = 0;
      sentence.setAttribute('role', 'button');
      original.append(sentence, ' ');
    }
    block.append(original);
    if (paragraph.translation && state.settings.showTranslation) {
      const translation = document.createElement('span');
      translation.className = 'script-translation';
      translation.lang = BASE_LANGUAGE;
      translation.textContent = paragraph.translation;
      block.append(translation);
    }
    fragment.append(block);
  }
  container.replaceChildren(fragment);
  dom<HTMLButtonElement>('scriptPlay').disabled = !script;
  highlightSentence(script && state.position?.id === script.id ? state.position.sentence : -1, false);
}
function highlightSentence(index: number, follow: boolean): void {
  const container = dom('scriptText');
  container.querySelector('.sentence.active')?.classList.remove('active');
  const sentence = container.querySelector<HTMLElement>(`[data-sentence="${index}"]`);
  sentence?.classList.add('active');
  // 글자를 보면서 듣는 사용 방식이라 읽는 문장이 늘 화면 가운데 오게 합니다.
  if (follow) sentence?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function play(from?: number): Promise<void> {
  const script = currentScript();
  if (!script) return;
  if (!speech.isSupported) { status('이 브라우저에서는 음성 합성을 지원하지 않습니다.'); return; }
  stopPlayback();
  const settings = { ...state.settings };
  const total = sentenceCount(script);
  const saved = state.position?.id === script.id ? state.position.sentence : 0;
  let start = Math.min(from ?? saved, total - 1);
  const controller = new AbortController(); state.controller = controller;
  const { signal } = controller;
  dom<HTMLButtonElement>('scriptStop').disabled = false;
  dom<HTMLButtonElement>('scriptPlay').textContent = '↻ 처음부터 다시 재생';
  void keepScreenAwake();
  try {
    for (let pass = 1; settings.repeats === 0 || pass <= settings.repeats; pass++) {
      const passLabel = settings.repeats === 1 ? '' : ` · ${pass}회째`;
      for (const segment of buildScriptSegments(script, settings, start)) {
        if (signal.aborted) return;
        setPosition(script, segment.sentence);
        highlightSentence(segment.sentence, true);
        status(`재생 중 · ${segment.sentence + 1} / ${total}문장${passLabel}`);
        await speech.speak(segment.text, segment.language, settings.rate, signal);
        if (signal.aborted) return;
        await sleep(segment.waitAfterMs, signal);
      }
      start = 0;
    }
    if (!signal.aborted) {
      setPosition(script, 0);
      status('스크립트를 끝까지 들었어요.');
    }
  } catch (error) {
    if (!signal.aborted) status(error instanceof Error ? error.message : '음성 재생 실패');
  } finally {
    if (state.controller === controller) {
      state.controller = null;
      releaseScreen();
      dom<HTMLButtonElement>('scriptStop').disabled = true;
      dom<HTMLButtonElement>('scriptPlay').textContent = '▶ 이어서 재생';
    }
  }
}
function updateSettings(): void {
  state.settings = normalizeScriptSettings({
    repeats: Number(select('scriptRepeats').value),
    sentenceDelayMs: Number(select('sentenceDelay').value),
    paragraphDelayMs: Number(select('paragraphDelay').value),
    rate: Number(input('scriptRate').value),
    showTranslation: input('showScriptTranslation').checked,
  });
  saveScriptSettings(state.settings);
  dom('scriptRateValue').textContent = `${state.settings.rate.toFixed(1)}×`;
}
function restoreSettings(): void {
  const s = state.settings;
  select('scriptRepeats').value = String(s.repeats);
  select('sentenceDelay').value = String(s.sentenceDelayMs);
  select('paragraphDelay').value = String(s.paragraphDelayMs);
  input('scriptRate').value = String(s.rate);
  input('showScriptTranslation').checked = s.showTranslation;
  dom('scriptRateValue').textContent = `${s.rate.toFixed(1)}×`;
}
async function reload(): Promise<void> {
  const payload = await fetchScripts().catch(() => null);
  state.scripts = payload?.scripts ?? [];
  state.lastLoadedAt = Date.now();
  refreshOptions();
  render();
  status(state.scripts.length ? '재생 버튼을 누르거나 문장을 눌러 들어 보세요.'
    : '등록된 스크립트가 없어요. Notion 스크립트 데이터베이스를 확인해 주세요.');
}
select('scriptSelect').addEventListener('change', () => {
  stopPlayback();
  const script = state.scripts.find(item => item.id === select('scriptSelect').value);
  if (script) setPosition(script, 0);
  render();
  status('재생 버튼을 누르거나 문장을 눌러 들어 보세요.');
});
for (const id of ['scriptRepeats', 'sentenceDelay', 'paragraphDelay']) {
  select(id).addEventListener('change', updateSettings);
}
input('scriptRate').addEventListener('input', updateSettings);
input('showScriptTranslation').addEventListener('change', () => { updateSettings(); render(); });
dom('scriptPlay').addEventListener('click', () => void play(state.controller ? 0 : undefined));
dom('scriptStop').addEventListener('click', () => { stopPlayback(); status('재생을 중지했어요. 이어서 재생하면 이 문장부터 읽어요.'); });
const sentenceOf = (event: Event): number | null => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-sentence]');
  return target ? Number(target.dataset.sentence) : null;
};
dom('scriptText').addEventListener('click', event => {
  const sentence = sentenceOf(event);
  if (sentence !== null) void play(sentence);
});
dom('scriptText').addEventListener('keydown', event => {
  const sentence = sentenceOf(event);
  if (sentence === null || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  void play(sentence);
});
document.addEventListener('visibilitychange', () => {
  restoreScreenWake(Boolean(state.controller));
  if (document.hidden || state.controller || Date.now() - state.lastLoadedAt < 15 * 60 * 1000) return;
  void reload();
});
registerServiceWorker();
restoreSettings();
void reload();
