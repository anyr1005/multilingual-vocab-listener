# Codex 개발 지침 — Vocabulary Listener

## 목적

- 개인용 **다국어 듣기·단어 암기 웹앱**. 관광통역안내사 중국어는 초기 데이터일 뿐이며 중국어 전용 앱으로 고정하지 않는다.
- **한 개념 → 여러 언어 표현**을 기본 데이터 모델로 사용한다. `id`는 개념의 안정적인 식별자이며 번역 표현으로 ID를 만들지 않는다.
- 단어 편집과 사전형 검색은 Notion, 카드/연속 TTS 학습과 복습은 웹앱이 담당한다.
- 사용자는 스마트폰에서 출퇴근 중 **글자를 보면서 음성으로 반복 학습**한다. 모바일 사용성을 우선한다.

## 기술과 제약

- Vanilla TypeScript + Vite + Node.js(TypeScript) Notion 동기화 + GitHub Actions + GitHub Pages.
- 런타임 서버·인증·DB는 없다. Notion Secrets는 Actions에만 두고 공개 파일에 넣지 않는다.
- Notion 데이터/앱 모두 GitHub Pages에서 **공개**됨을 전제한다.
- `src/domain/words.ts`는 `schemaVersion:2` 타입과 검증을 담당하며 이전 v1 중국어 JSON을 이행한다.
- `terms`는 `Record<BCP47 locale, Expression>` 형식이다. `ko-KR`은 현재 기준 언어이며, 다른 언어는 선택적으로 존재한다.
- 다의어와 개념이 다른 동음이의어는 별도 개념/Notion 행으로 구분한다. 자동 1:1 번역이라고 가정하지 말 것.
- `src/logic/playlist.ts`는 TTS 순서와 반복을 순수 함수로 산출한다. 특정 외국어를 하드코딩하지 않는다.
- `src/logic/speech.ts`는 TTS 실현만 담당하고 선택 언어의 BCP47 코드를 사용한다.
- 학습 기록은 **개념ID와 목표 언어를 조합한 키**로 저장한다. v1 중국어 기록 호환 동작을 유지한다.
- 스크립트(`src/domain/scripts.ts`)는 단어 개념과 별개인 한 언어의 긴 글이다. Notion 별도 DB의 페이지 본문에서 읽고, 동기화 시점에 문장으로 나눠 `public/data/scripts.json`으로 내보낸다. 화면은 단어장과 별도 페이지 `script/index.html`(`src/scriptPage.ts`)이며, 단어장에서는 바로가기를 두지 않고 주소로 직접 연다. 하위 페이지는 `<meta name="app-root">`로 루트를 알리고 데이터 URL은 `appUrl()`로 만든다.
- DOM 렌더링은 textContent/노드 생성으로 하며 Notion 사용자 내용을 innerHTML에 삽입하지 않는다.

## 안정성 체크리스트

1. Notion 동기화는 API 오류/일부 누락/0개/비정상 데이터에서 **기존 공개 JSON을 덮어쓰지 말 것**.
2. 새 데이터 모델 변경 시 `examples/words.sample.json`(로컬 개발용 샘플), `scripts/notion.ts`, 단위 테스트도 함께 변경. `public/data/words.json`은 동기화 결과물이며 저장소에 두지 않는다.
3. 한 개념에 다수 언어가 있을 때 UI가 번역을 올바르게 노출하고, 대상 언어가 없는 개념은 해당 언어 학습에서 제외하는지 확인.
4. 단어 검색은 모든 언어의 원문/발음/예문을 검색할 수 있도록 유지.
5. GitHub Actions Secrets가 정적 웹사이트에 유출되지 않도록 검토.
6. `npm run check` 및 스마트폰 실기기 TTS 확인. 브라우저의 백그라운드 TTS 재생을 보장한다고 표현하지 말 것.
7. Notion 원본 변경에 따른 ID/언어 키 이행을 테스트.
8. 종속성 확대보다 실제 학습 경험과 유지보수성을 우선.

## 확장 방향

- 현재는 언어별 하나의 대표 표현(`Expression`)만 지원. 동의어/복수 발음/품사별 의미를 위해 N:M 개념 그래프가 필요해질 때 별도 모델 설계.
- 간격 반복 복습(SRS), 개인 학습 데이터 백업/동기화, 발음 선택, 오프라인 PWA 캐시.
- 코드 수정 없이 Notion `추가 언어 JSON` 속성으로 새로운 언어를 추가할 수 있으나, 자주 쓰는 언어는 정식 필드와 UX를 고려.

## 명령어

```bash
npm install
npm run dev
npm run check
npm run sync:notion
```

세부 연결·배포는 `README.md`를 확인.
