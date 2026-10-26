/** GitHub Actions 또는 로컬 셸에서 실행되는 Notion → 정적 JSON 동기화 작업. */
import { mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseScriptPayload, type ScriptPayload } from '../src/domain/scripts.js';
import { parseWordPayload } from '../src/domain/words.js';
import { collectScripts, collectWords, resolveDataSourceId } from './notion.js';

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
}
async function writeAtomic(file: string, value: unknown): Promise<void> {
  const dest = resolve(process.cwd(), file);
  await mkdir(dirname(dest), { recursive: true });
  const temp = `${dest}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temp, dest);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN 환경 변수가 필요합니다.');
  const updatedAt = new Date().toISOString();
  const sourceId = await resolveDataSourceId(token,
    process.env.NOTION_DATA_SOURCE_ID, process.env.NOTION_DATABASE_ID);
  const words = await collectWords(token, sourceId);
  const payload = parseWordPayload({
    schemaVersion: 2,
    source: 'notion',
    updatedAt,
    count: words.length,
    words,
  });
  // 스크립트 데이터베이스는 선택 사항입니다. 설정하지 않으면 앱에서 스크립트 탭이 숨겨집니다.
  const scriptSourceId = process.env.NOTION_SCRIPTS_DATA_SOURCE_ID || process.env.NOTION_SCRIPTS_DATABASE_ID
    ? await resolveDataSourceId(token, process.env.NOTION_SCRIPTS_DATA_SOURCE_ID,
      process.env.NOTION_SCRIPTS_DATABASE_ID, 'NOTION_SCRIPTS')
    : null;
  let scripts: ScriptPayload | null = null;
  if (scriptSourceId) {
    const list = await collectScripts(token, scriptSourceId);
    scripts = parseScriptPayload({ schemaVersion: 1, source: 'notion', updatedAt, count: list.length, scripts: list });
  }
  // 둘 다 받은 뒤에 씁니다. 한쪽만 갱신되어 단어와 스크립트의 시점이 어긋나지 않게 합니다.
  const args = process.argv.slice(2);
  const file = option(args, '--output', 'public/data/words.json');
  await writeAtomic(file, payload);
  console.log(`Notion 동기화 완료: ${payload.count}개 단어 → ${file}`);
  if (scripts) {
    const scriptFile = option(args, '--scripts-output', 'public/data/scripts.json');
    await writeAtomic(scriptFile, scripts);
    console.log(`Notion 동기화 완료: ${scripts.count}개 스크립트 → ${scriptFile}`);
  }
}

main().catch((error: unknown) => {
  // 오류 시 기존 JSON을 수정하지 않으며, GitHub Actions 배포도 중단됩니다.
  console.error('Notion 동기화 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
