import { DEFAULT_SETTINGS, type Conversation, type Language, type Settings, type Theme } from './types';

const CHATS_KEY = 'saya:chats';
const SETTINGS_KEY = 'saya:settings';
const API_KEY_LOCAL = 'saya:google-ai-key';
const API_KEY_SESSION = 'saya:google-ai-key:session';

function canUseStorage(storage: Storage | undefined): storage is Storage {
  if (!storage) return false;
  try {
    const test = 'saya:storage-test';
    storage.setItem(test, '1');
    storage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

function local(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function session(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function isLanguage(value: unknown): value is Language {
  return value === 'ar' || value === 'en';
}

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

export function loadChats(): Conversation[] {
  const storage = local();
  if (!canUseStorage(storage)) return [];
  const parsed = parseJson<unknown>(storage.getItem(CHATS_KEY), []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is Conversation => {
    if (!item || typeof item !== 'object') return false;
    const chat = item as Partial<Conversation>;
    return typeof chat.id === 'string'
      && typeof chat.title === 'string'
      && Array.isArray(chat.messages)
      && typeof chat.createdAt === 'number'
      && typeof chat.updatedAt === 'number';
  });
}

export function saveChats(chats: Conversation[]) {
  const storage = local();
  if (!canUseStorage(storage)) return;
  storage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 80)));
}

export function loadSettings(): Settings {
  const storage = local();
  if (!canUseStorage(storage)) return DEFAULT_SETTINGS;
  const raw = parseJson<Partial<Settings>>(storage.getItem(SETTINGS_KEY), {});
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    language: isLanguage(raw.language) ? raw.language : DEFAULT_SETTINGS.language,
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model : DEFAULT_SETTINGS.model,
    rememberKey: typeof raw.rememberKey === 'boolean' ? raw.rememberKey : DEFAULT_SETTINGS.rememberKey,
    temperature: typeof raw.temperature === 'number' && Number.isFinite(raw.temperature) ? Math.min(2, Math.max(0, raw.temperature)) : DEFAULT_SETTINGS.temperature,
    maxOutputTokens: typeof raw.maxOutputTokens === 'number' && Number.isFinite(raw.maxOutputTokens) ? Math.min(8192, Math.max(256, Math.round(raw.maxOutputTokens))) : DEFAULT_SETTINGS.maxOutputTokens,
    systemPrompt: typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim() ? raw.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
  };
}

export function saveSettings(settings: Settings) {
  const storage = local();
  if (!canUseStorage(storage)) return;
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadApiKey(): string {
  const localStorage = local();
  const sessionStorage = session();
  if (canUseStorage(localStorage)) {
    const saved = localStorage.getItem(API_KEY_LOCAL);
    if (saved) return saved;
  }
  if (canUseStorage(sessionStorage)) return sessionStorage.getItem(API_KEY_SESSION) || '';
  return '';
}

export function saveApiKey(apiKey: string, remember: boolean) {
  const localStorage = local();
  const sessionStorage = session();
  if (canUseStorage(localStorage)) localStorage.removeItem(API_KEY_LOCAL);
  if (canUseStorage(sessionStorage)) sessionStorage.removeItem(API_KEY_SESSION);
  if (!apiKey) return;
  if (remember) {
    if (canUseStorage(localStorage)) localStorage.setItem(API_KEY_LOCAL, apiKey);
  } else if (canUseStorage(sessionStorage)) {
    sessionStorage.setItem(API_KEY_SESSION, apiKey);
  }
}

export function clearAllData() {
  const localStorage = local();
  const sessionStorage = session();
  if (canUseStorage(localStorage)) {
    localStorage.removeItem(CHATS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(API_KEY_LOCAL);
  }
  if (canUseStorage(sessionStorage)) sessionStorage.removeItem(API_KEY_SESSION);
}
