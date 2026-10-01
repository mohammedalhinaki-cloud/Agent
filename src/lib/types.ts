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
  model: 'gemini-1.5-flash',
  rememberKey: false,
  temperature: 0.7,
  maxOutputTokens: 2048,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

export const MODEL_OPTIONS = [
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];
