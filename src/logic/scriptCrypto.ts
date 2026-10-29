/**
 * 공개 Pages에 올리는 스크립트 JSON을 비밀번호로 암호화합니다.
 * 동기화(Node)와 스크립트 페이지(브라우저)가 같은 Web Crypto 코드를 씁니다.
 * PBKDF2-SHA256으로 키를 만들고 AES-GCM으로 암호화하므로, 틀린 키는 복호화 단계에서 실패합니다.
 */
import { parseScriptPayload, type ScriptPayload } from '../domain/scripts.js';

export const SCRIPT_KDF_ITERATIONS = 600_000;
/**
 * 기기에 기억한 키가 15분마다 새로 동기화돼도 맞도록 salt는 고정합니다.
 * 비밀번호에서 salt를 만들면 공개 파일에 빠른 해시가 드러나므로 쓰지 않습니다.
 */
const DEFAULT_SALT = new TextEncoder().encode('multilingual-vocab-listener/scripts/v1');

export interface EncryptedScripts {
  encrypted: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}
/** 기기에 기억해 두는 키. 비밀번호 자체는 저장하지 않습니다. */
export interface ScriptKey { salt: string; iterations: number; key: string }
export type ScriptSource = ScriptPayload | EncryptedScripts;
export class WrongPasswordError extends Error {
  constructor() { super('비밀번호가 맞지 않아요.'); }
}

const subtle = () => globalThis.crypto.subtle;
type AesKey = Awaited<ReturnType<ReturnType<typeof subtle>['importKey']>>;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<AesKey> {
  const material = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function decrypt(envelope: EncryptedScripts, key: AesKey): Promise<ScriptPayload> {
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.data));
  } catch { throw new WrongPasswordError(); }
  return parseScriptPayload(JSON.parse(new TextDecoder().decode(plain)) as unknown);
}

export async function encryptScriptPayload(payload: ScriptPayload, password: string,
  iterations = SCRIPT_KDF_ITERATIONS): Promise<EncryptedScripts> {
  const salt = new Uint8Array(DEFAULT_SALT);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { encrypted: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)) };
}

/** 암호화 파일이 아니면 null, 암호화 파일인데 형식이 깨졌으면 예외. */
export function parseEncryptedScripts(raw: unknown): EncryptedScripts | null {
  if (!raw || typeof raw !== 'object' || !('encrypted' in raw)) return null;
  const value = raw as Record<string, unknown>;
  const base64 = (field: string) => typeof value[field] === 'string' && /^[A-Za-z0-9+/]+=*$/.test(value[field]);
  if (value.encrypted !== 'AES-GCM' || value.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(value.iterations)
    || (value.iterations as number) < 1 || !base64('salt') || !base64('iv') || !base64('data')) {
    throw new Error('암호화된 스크립트 형식이 올바르지 않습니다.');
  }
  return value as unknown as EncryptedScripts;
}
export function parseScriptSource(raw: unknown): ScriptSource {
  return parseEncryptedScripts(raw) ?? parseScriptPayload(raw);
}
export const isEncrypted = (source: ScriptSource): source is EncryptedScripts => 'encrypted' in source;

/** 비밀번호로 엽니다. 다음부터 비밀번호 없이 열 수 있는 키도 함께 돌려줍니다. */
export async function unlockScripts(envelope: EncryptedScripts, password: string):
  Promise<{ payload: ScriptPayload; key: ScriptKey }> {
  const key = await deriveKey(password, fromBase64(envelope.salt), envelope.iterations);
  const payload = await decrypt(envelope, key);
  const raw = new Uint8Array(await subtle().exportKey('raw', key));
  return { payload, key: { salt: envelope.salt, iterations: envelope.iterations, key: toBase64(raw) } };
}
/** 기억한 키로 엽니다. 비밀번호가 바뀌었으면 WrongPasswordError. */
export async function openScripts(envelope: EncryptedScripts, saved: ScriptKey): Promise<ScriptPayload> {
  if (saved.salt !== envelope.salt || saved.iterations !== envelope.iterations) throw new WrongPasswordError();
  const key = await subtle().importKey('raw', fromBase64(saved.key), 'AES-GCM', false, ['decrypt']);
  return decrypt(envelope, key);
}
