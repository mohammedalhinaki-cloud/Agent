import type { AgentStatus, Message, Settings } from './types';

interface AgentCallbacks {
  onStatus: (status: AgentStatus) => void;
  onText: (text: string) => void;
  onStep?: (step: { tool: string; summary: string; result: string; ok: boolean }) => void;
}

interface GeminiPart { text?: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }
interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string; code?: number };
}

function toGeminiRole(role: Message['role']): GeminiContent['role'] {
  return role === 'assistant' ? 'model' : 'user';
}

function buildContents(messages: Message[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    if (!text) continue;
    const role = toGeminiRole(message.role);
    const last = contents[contents.length - 1];
    // Gemini is happiest when adjacent messages with the same role are merged.
    if (last?.role === role) last.parts.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

async function readError(response: Response): Promise<Error> {
  const status = response.status;
  let body = '';
  try { body = await response.text(); } catch { /* ignore */ }
  const lower = body.toLowerCase();

  if (status === 401 || status === 403 || lower.includes('api key not valid') || lower.includes('permission')) return new Error('AUTH_ERROR');
  if (status === 404 || lower.includes('model') || lower.includes('not found')) return new Error('MODEL_ERROR');
  if (status === 429) return new Error('RATE_LIMIT');
  return new Error(`HTTP_${status}`);
}

function extractText(chunk: GeminiStreamChunk): string {
  if (chunk.error?.message) throw new Error(chunk.error.status || chunk.error.message);
  if (chunk.promptFeedback?.blockReason) throw new Error(`MODEL_ERROR:${chunk.promptFeedback.blockReason}`);
  return chunk.candidates?.flatMap(candidate => candidate.content?.parts || []).map(part => part.text || '').join('') || '';
}

function parseSseEvent(event: string): string[] {
  return event
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean);
}

export async function runAgent(messages: Message[], settings: Settings, apiKey: string, signal: AbortSignal, callbacks: AgentCallbacks) {
  callbacks.onStatus('analyzing');
  const contents = buildContents(messages);
  if (!contents.length) return;

  callbacks.onStatus('processing');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: settings.systemPrompt }] },
      generationConfig: {
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens,
      },
    }),
  });

  if (!response.ok) throw await readError(response);
  if (!response.body) throw new Error('STREAM_UNAVAILABLE');

  callbacks.onStatus('writing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let output = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';

    for (const event of events) {
      for (const data of parseSseEvent(event)) {
        if (data === '[DONE]') return;
        const chunk = JSON.parse(data) as GeminiStreamChunk;
        const text = extractText(chunk);
        if (text) {
          output += text;
          callbacks.onText(output);
        }
      }
    }
  }

  buffer += decoder.decode();
  for (const data of parseSseEvent(buffer)) {
    if (data === '[DONE]') return;
    const chunk = JSON.parse(data) as GeminiStreamChunk;
    const text = extractText(chunk);
    if (text) {
      output += text;
      callbacks.onText(output);
    }
  }
}
