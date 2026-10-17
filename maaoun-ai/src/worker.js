const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const SOURCES = {
  openai: { chat: "https://api.openai.com/v1/chat/completions", models: "https://api.openai.com/v1/models" },
  gemini: { models: "https://generativelanguage.googleapis.com/v1beta/models" },
  anthropic: { chat: "https://api.anthropic.com/v1/messages", models: "https://api.anthropic.com/v1/models" },
  deepseek: { chat: "https://api.deepseek.com/chat/completions", models: "https://api.deepseek.com/models" },
  groq: { chat: "https://api.groq.com/openai/v1/chat/completions", models: "https://api.groq.com/openai/v1/models" },
  openrouter: { chat: "https://openrouter.ai/api/v1/chat/completions", models: "https://openrouter.ai/api/v1/models" }
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
function upstreamHeaders(provider, key) {
  if (provider === "gemini") return { "content-type": "application/json", "x-goog-api-key": key };
  if (provider === "anthropic") return { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
  return { "content-type": "application/json", authorization: "Bearer " + key };
}
function validPayload(data, needsMessages) {
  if (!data || typeof data !== "object" || !SOURCES[data.provider] || typeof data.key !== "string" || data.key.length < 8 || data.key.length > 600) return "مزوّد الخدمة أو المفتاح غير صالح.";
  if (needsMessages && (!Array.isArray(data.messages) || !data.messages.length || data.messages.length > 35)) return "سجل المحادثة طويل جدًا.";
  if (needsMessages && data.messages.some(m => !m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 30000 || (m.images && (!Array.isArray(m.images) || m.images.length > 2 || m.images.some(i => typeof i !== "string" || i.length > 3000000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(i)))))) return "بيانات الرسالة أو الصورة غير صالحة.";
  if (needsMessages && (typeof data.model !== "string" || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(data.model))) return "اسم النموذج غير صالح.";
  return null;
}
function makeImageParts(provider, msg) {
  const images = msg.images || [];
  if (!images.length) return msg.content;
  if (provider === "gemini") return [{ text: msg.content }, ...images.map(url => {
    const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(url);
    return { inlineData: { mimeType: match[1], data: match[2] } };
  })];
  if (provider === "anthropic") return [{ type: "text", text: msg.content || "حلل الصورة." }, ...images.map(url => {
    const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(url);
    return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
  })];
  return [{ type: "text", text: msg.content || "حلل الصورة." }, ...images.map(url => ({ type: "image_url", image_url: { url } }))];
}
function buildRequest(data) {
  const { provider, model, messages } = data;
  const headers = upstreamHeaders(provider, data.key);
  if (provider === "gemini") {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: Array.isArray(makeImageParts(provider, m)) ? makeImageParts(provider, m) : [{ text: m.content }]
    }));
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse";
    const payload = { contents };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    return { url, init: { method: "POST", headers, body: JSON.stringify(payload) } };
  }
  if (provider === "anthropic") {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const chat = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: makeImageParts(provider, m) }));
    return { url: SOURCES[provider].chat, init: { method: "POST", headers, body: JSON.stringify({ model, system: system || undefined, messages: chat, max_tokens: 4096, stream: true }) } };
  }
  return {
    url: SOURCES[provider].chat,
    init: { method: "POST", headers, body: JSON.stringify({
      model, messages: messages.map(m => ({ role: m.role, content: makeImageParts(provider, m) })), stream: true
    }) }
  };
}
function streamResponse(response, provider) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body.getReader();
      let buffer = "";
      let finished = false;
      function emit(obj) { controller.enqueue(encoder.encode("data: " + JSON.stringify(obj) + "\n\n")); }
      function parseEvent(chunk) {
        const lines = chunk.split("\n").map(line => line.trimEnd());
        const raw = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!raw || raw === "[DONE]") return;
        let item;
        try { item = JSON.parse(raw); } catch { return; }
        let delta = "";
        if (provider === "gemini") delta = (item.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
        else if (provider === "anthropic") {
          if (item.type === "content_block_delta") delta = item.delta?.text || "";
          if (item.type === "error") { emit({ error: item.error?.message || "Anthropic stream error" }); return; }
        } else {
          delta = item.choices?.[0]?.delta?.content || "";
          if (Array.isArray(delta)) delta = delta.map(part => part.text || "").join("");
          if (item.error) { emit({ error: item.error.message || "Provider stream error" }); return; }
        }
        if (delta) emit({ delta });
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          if (buffer.length > 1000000) throw new Error("استجابة كبيرة بصورة غير متوقعة.");
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            parseEvent(buffer.slice(0, index));
            buffer = buffer.slice(index + 2);
          }
        }
        if (buffer.trim()) parseEvent(buffer);
        emit({ done: true });
        finished = true;
      } catch (e) {
        if (!finished) emit({ error: "انقطع الاتصال أثناء استقبال الرد." });
      } finally {
        try { reader.releaseLock(); } catch {}
        controller.close();
      }
    },
    cancel() { response.body?.cancel().catch(() => {}); }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff" }
  });
}
async function handleApi(request) {
  const url = new URL(request.url);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).origin !== url.origin) return json({ error: "Origin not allowed" }, 403); }
    catch { return json({ error: "Origin not allowed" }, 403); }
  }
  if (Number(request.headers.get("content-length") || 0) > 6500000) return json({ error: "الملفات كبيرة جدًا." }, 413);
  let data;
  try { data = await request.json(); } catch { return json({ error: "JSON غير صالح." }, 400); }
  if (JSON.stringify(data).length > 6500000) return json({ error: "الطلب كبير جدًا." }, 413);
  const isChat = url.pathname === "/api/chat";
  if (!isChat && url.pathname !== "/api/models") return json({ error: "Not found" }, 404);
  const err = validPayload(data, isChat);
  if (err) return json({ error: err }, 400);
  const provider = data.provider;
  let target;
  let init;
  if (isChat) ({ url: target, init } = buildRequest(data));
  else {
    target = SOURCES[provider].models;
    init = { method: "GET", headers: upstreamHeaders(provider, data.key) };
  }
  let upstream;
  try {
    upstream = await fetch(target, { ...init, signal: AbortSignal.timeout(isChat ? 120000 : 20000) });
  } catch {
    return json({ error: "تعذر الاتصال بمزوّد النموذج. تحقق من الشبكة." }, 502);
  }
  if (!upstream.ok) {
    let explanation = "";
    try {
      const errData = await upstream.json();
      explanation = errData?.error?.message || errData?.message || JSON.stringify(errData).slice(0, 500);
    } catch { explanation = "رفض مزوّد الخدمة الطلب."; }
    return json({ error: String(explanation).slice(0, 500), status: upstream.status }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
  }
  if (isChat) return streamResponse(upstream, provider);
  let modelData;
  try { modelData = await upstream.json(); } catch { return json({ error: "تعذر قراءة قائمة النماذج." }, 502); }
  const models = (provider === "gemini" ? modelData.models || [] : modelData.data || [])
    .filter(m => provider !== "gemini" || (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => String(m.id || m.name || "").replace(/^models\//, ""))
    .filter(x => /^[a-zA-Z0-9._:/-]{1,160}$/.test(x))
    .slice(0, 400);
  return json({ models });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-frame-options", "DENY");
    headers.set("permissions-policy", "camera=(), microphone=(self), geolocation=()");
    headers.set("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    return new Response(asset.body, { status: asset.status, headers });
  }
};