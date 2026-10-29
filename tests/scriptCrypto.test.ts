import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScriptPayload } from '../src/domain/scripts.js';
import { encryptScriptPayload, isEncrypted, openScripts, parseEncryptedScripts, parseScriptSource, unlockScripts,
  WrongPasswordError } from '../src/logic/scriptCrypto.js';

// 테스트 속도를 위해 반복 횟수만 줄입니다. 실제 동기화는 SCRIPT_KDF_ITERATIONS를 씁니다.
const ITERATIONS = 1000;
const sample = parseScriptPayload(JSON.parse(readFileSync('examples/scripts.sample.json', 'utf8')) as unknown);
const PASSWORD = 'correct horse battery';

describe('스크립트 암호화', () => {
  it('비밀번호로 연 내용이 원본과 같고, 공개 파일에는 원문이 없다', async () => {
    const envelope = await encryptScriptPayload(sample, PASSWORD, ITERATIONS);
    expect(JSON.stringify(envelope)).not.toContain(sample.scripts[0]!.title);
    const { payload } = await unlockScripts(parseEncryptedScripts(JSON.parse(JSON.stringify(envelope)))!, PASSWORD);
    expect(payload).toEqual(sample);
  });
  it('틀린 비밀번호는 거부한다', async () => {
    const envelope = await encryptScriptPayload(sample, PASSWORD, ITERATIONS);
    await expect(unlockScripts(envelope, 'wrong password!')).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('기억한 키는 다시 동기화한 파일도 열고, 비밀번호가 바뀌면 열지 못한다', async () => {
    const { key } = await unlockScripts(await encryptScriptPayload(sample, PASSWORD, ITERATIONS), PASSWORD);
    expect(JSON.stringify(key)).not.toContain(PASSWORD);
    const resynced = await encryptScriptPayload(sample, PASSWORD, ITERATIONS);
    expect((await openScripts(resynced, key)).count).toBe(sample.count);
    const changed = await encryptScriptPayload(sample, 'another long password', ITERATIONS);
    await expect(openScripts(changed, key)).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('평문과 암호화 파일을 구분하고, 깨진 암호화 파일은 거부한다', async () => {
    const envelope = await encryptScriptPayload(sample, PASSWORD, ITERATIONS);
    expect(isEncrypted(parseScriptSource(envelope))).toBe(true);
    expect(isEncrypted(parseScriptSource(sample))).toBe(false);
    expect(parseEncryptedScripts(sample)).toBeNull();
    expect(() => parseEncryptedScripts({ ...envelope, data: '<script>' })).toThrow();
    expect(() => parseEncryptedScripts({ ...envelope, iterations: 0 })).toThrow();
  });
});
