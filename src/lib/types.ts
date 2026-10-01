export type Language = 'ar' | 'en';
export type Theme = 'dark' | 'light';
export type Role = 'user' | 'assistant';
export type AgentStatus = 'analyzing' | 'executing' | 'processing' | 'writing';

export interface AgentStep {
  tool: string;
  summary: string;
  result: string;
  ok: boolean;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
  steps?: AgentStep[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  language: Language;
  theme: Theme;
  model: string;
  rememberKey: boolean;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are Saya, a helpful bilingual Arabic and English AI assistant. Answer clearly, be concise unless the user asks for detail, preserve the user language, and format useful answers with Markdown.';

export const DEFAULT_SETTINGS: Settings = {
  language: 'ar',
  theme: 'dark',
  model: 'gemini-flash-latest',
  rememberKey: false,
  temperature: 0.7,
  maxOutputTokens: 2048,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

// `gemini-flash-latest` is a Google-managed alias that always points at the newest
// stable Flash model, so it keeps working when specific versions are retired.
export const FALLBACK_MODEL = 'gemini-flash-latest';

// Current Gemini Developer API models (generativelanguage.googleapis.com).
// Gemini 1.5 / 2.0 models are retired and 404 for every key; 2.5 is limited to
// keys that already used it, so it stays as a legacy option only.
export const MODEL_OPTIONS = [
  { value: 'gemini-flash-latest', label: 'Gemini Flash (Latest)' },
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Legacy)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Legacy)' },
];

export const MODEL_IDS = new Set<string>(MODEL_OPTIONS.map(option => option.value));

export function modelLabel(model: string): string {
  return MODEL_OPTIONS.find(option => option.value === model)?.label ?? model;
}
