/** GitHub Actions 또는 로컬 셸에서 실행되는 Notion → 정적 JSON 동기화 작업. */
import { mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseWordPayload } from '../src/domain/words.js';
import { collectWords, resolveDataSourceId } from './notion.js';

async function main(): Promise<void> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN 환경 변수가 필요합니다.');
  const sourceId = await resolveDataSourceId(token,
    process.env.NOTION_DATA_SOURCE_ID, process.env.NOTION_DATABASE_ID);
  const words = await collectWords(token, sourceId);
  const payload = parseWordPayload({
    schemaVersion: 2,
    source: 'notion',
    updatedAt: new Date().toISOString(),
    count: words.length,
    words,
  });
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const file = outputIndex >= 0 && args[outputIndex + 1]
    ? args[outputIndex + 1]! : 'public/data/words.json';
  const dest = resolve(process.cwd(), file);
  await mkdir(dirname(dest), { recursive: true });
  const temp = `${dest}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    await rename(temp, dest);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  console.log(`Notion 동기화 완료: ${payload.count}개 단어 → ${file}`);
}

main().catch((error: unknown) => {
  // 오류 시 기존 JSON을 수정하지 않으며, GitHub Actions 배포도 중단됩니다.
  console.error('Notion 동기화 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
