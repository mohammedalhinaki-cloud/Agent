import { FALLBACK_MODEL, type AgentStatus, type Message, type Settings } from './types';

interface AgentCallbacks {
  onStatus: (status: AgentStatus) => void;
  onText: (text: string) => void;
  onStep?: (step: { tool: string; summary: string; result: string; ok: boolean }) => void;
  /** Called once when the selected model is unavailable and the request is retried with `model`. */
  onModelFallback?: (model: string) => void;
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

const MODEL_UNAVAILABLE_PATTERN = /not found|does not exist|not supported|unsupported|is unavailable|has been deprecated|retired|shut down|limiting access/;

async function readError(response: Response): Promise<Error> {
  const status = response.status;
  let body = '';
  try { body = await response.text(); } catch { /* ignore */ }
  const lower = body.toLowerCase();

  if (status === 401 || lower.includes('api key not valid') || lower.includes('api_key_invalid')) return new Error('AUTH_ERROR');
  // A 403 that is not about a specific model is a key/permission problem.
  if (status === 403 && !lower.includes('model')) return new Error('AUTH_ERROR');
  if (status === 404 || MODEL_UNAVAILABLE_PATTERN.test(lower)) return new Error('MODEL_ERROR');
  if (status === 429) return new Error('RATE_LIMIT');
  return new Error(`HTTP_${status}`);
}

function inStreamError(error: { status?: string; message?: string }): Error {
  const status = error.status || '';
  const message = error.message || '';
  if (status === 'NOT_FOUND' || MODEL_UNAVAILABLE_PATTERN.test(message)) return new Error('MODEL_ERROR');
  if (status === 'UNAUTHENTICATED' || status === 'PERMISSION_DENIED' || /api key not valid/i.test(message)) return new Error('AUTH_ERROR');
  if (status === 'RESOURCE_EXHAUSTED') return new Error('RATE_LIMIT');
  return new Error(status || message || 'UNKNOWN');
}

function extractText(chunk: GeminiStreamChunk): string {
  if (chunk.error) throw inStreamError(chunk.error);
  // Safety blocks are prompt-specific, not a model-availability problem.
  if (chunk.promptFeedback?.blockReason) throw new Error(`BLOCKED:${chunk.promptFeedback.blockReason}`);
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

async function streamGemini(model: string, contents: GeminiContent[], settings: Settings, apiKey: string, signal: AbortSignal, callbacks: AgentCallbacks) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
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

export async function runAgent(messages: Message[], settings: Settings, apiKey: string, signal: AbortSignal, callbacks: AgentCallbacks) {
  callbacks.onStatus('analyzing');
  const contents = buildContents(messages);
  if (!contents.length) return;

  callbacks.onStatus('processing');
  // If the selected model is unavailable for this key (retired or restricted),
  // retry once with the always-available `gemini-flash-latest` alias instead of failing.
  const attempts = settings.model === FALLBACK_MODEL ? [FALLBACK_MODEL] : [settings.model, FALLBACK_MODEL];
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const model = attempts[attempt];
    try {
      await streamGemini(model, contents, settings, apiKey, signal, callbacks);
      return;
    } catch (error) {
      const modelUnavailable = error instanceof Error && error.message.split(':')[0] === 'MODEL_ERROR';
      if (modelUnavailable && attempt < attempts.length - 1 && !signal.aborted) {
        callbacks.onModelFallback?.(FALLBACK_MODEL);
        continue;
      }
      throw error;
    }
  }
}
