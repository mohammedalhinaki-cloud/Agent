"use strict";
const $ = id => document.getElementById(id);
const PROVIDERS = {
  gemini: { label: "Google Gemini", model: "gemini-2.5-flash" },
  openai: { label: "OpenAI", model: "gpt-4.1-mini" },
  groq: { label: "Groq", model: "llama-3.3-70b-versatile" },
  deepseek: { label: "DeepSeek", model: "deepseek-chat" },
  anthropic: { label: "Anthropic", model: "claude-sonnet-4-5" },
  openrouter: { label: "OpenRouter", model: "openai/gpt-4o-mini" }
};
const KEYS_STORAGE = "maaoun.keys.v1";
const CHATS_STORAGE = "maaoun.chats.v1";
const PREF_STORAGE = "maaoun.prefs.v1";
function readStorage(storage, key, fallback) {
  try {
    const item = storage.getItem(key);
    return item === null ? fallback : JSON.parse(item);
  } catch { return fallback; }
}
const persistentKeys = readStorage(localStorage, KEYS_STORAGE, []);
const sessionKeys = readStorage(sessionStorage, KEYS_STORAGE, []);
let keys = [...(Array.isArray(persistentKeys) ? persistentKeys : []), ...(Array.isArray(sessionKeys) ? sessionKeys : [])];
let chats = readStorage(localStorage, CHATS_STORAGE, []);
if (!Array.isArray(chats)) chats = [];
chats = chats.filter(chat => chat && typeof chat.id === "string" && Array.isArray(chat.messages));
const prefs = readStorage(localStorage, PREF_STORAGE, {});
let selectedKeyId = prefs.selectedKeyId || keys[0]?.id || "";
let selectedModel = prefs.model || "";
let systemPrompt = typeof prefs.systemPrompt === "string" ? prefs.systemPrompt : "";
let activeChatId = chats[0]?.id || null;
let busy = false;
let controller = null;
let pendingFiles = [];
let alertTimer = null;
const now = () => new Date().toISOString();
const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2);
const selectedKey = () => keys.find(k => k.id === selectedKeyId);
const currentChat = () => chats.find(c => c.id === activeChatId);
function preferences() {
  try { localStorage.setItem(PREF_STORAGE, JSON.stringify({ selectedKeyId, model: selectedModel, systemPrompt })); }
  catch { notify("تعذر حفظ التفضيلات في المتصفح."); }
}
function saveKeys() {
  try {
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys.filter(k => k.saved)));
    sessionStorage.setItem(KEYS_STORAGE, JSON.stringify(keys.filter(k => !k.saved)));
  } catch { notify("تعذر حفظ المفتاح. قد تكون مساحة المتصفح ممتلئة."); }
}
function saveChats() {
  try {
    // Keep text messages while avoiding persistent copies of images and large attachments.
    const clean = chats.slice(0, 60).map(c => ({
      id: c.id, title: c.title, updated: c.updated,
      messages: c.messages.slice(-100).map(m => ({ role: m.role, content: m.content.slice(0, 30000), imageCount: m.images?.length || m.imageCount || 0 }))
    }));
    localStorage.setItem(CHATS_STORAGE, JSON.stringify(clean));
  } catch { notify("امتلأت مساحة التخزين؛ صدّر المحادثات للاحتفاظ بها."); }
}
function notify(message) {
  const el = $("notice");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { el.hidden = true; }, 7000);
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("overlay").classList.remove("visible");
  $("overlay").hidden = true;
}
function renderChats() {
  const list = $("chatList");
  list.replaceChildren();
  const filter = $("searchChats").value.trim().toLowerCase();
  for (const chat of [...chats].sort((a, b) => (b.updated || "").localeCompare(a.updated || ""))) {
    if (filter && !(chat.title || "").toLowerCase().includes(filter)) continue;
    const button = document.createElement("div");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.className = "chatItem" + (chat.id === activeChatId ? " active" : "");
    const label = document.createElement("span");
    label.className = "chatLabel";
    label.textContent = "◉ " + (chat.title || "محادثة جديدة");
    button.append(label);
    button.onclick = () => { if (!busy) { activeChatId = chat.id; renderAll(); closeSidebar(); } };
    button.onkeydown = e => { if (e.target === button && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); button.click(); } };
    const del = document.createElement("button");
    del.className = "deleteChat";
    del.textContent = "×";
    del.title = "حذف المحادثة";
    del.setAttribute("aria-label", "حذف المحادثة");
    del.onclick = e => {
      e.stopPropagation();
      if (busy || !confirm("حذف هذه المحادثة نهائيًا من الجهاز؟")) return;
      chats = chats.filter(c => c.id !== chat.id);
      if (activeChatId === chat.id) activeChatId = chats[0]?.id || null;
      saveChats(); renderAll();
    };
    button.append(del);
    list.append(button);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "emptyNote";
    empty.textContent = "لا توجد محادثات.";
    list.append(empty);
  }
}
function inlineFormat(element, content) {
  const parts = String(content).split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const node = document.createElement("strong");
      node.textContent = part.slice(2, -2);
      element.append(node);
    } else if (part.startsWith("\`") && part.endsWith("\`") && part.length > 2) {
      const node = document.createElement("code");
      node.textContent = part.slice(1, -1);
      element.append(node);
    } else element.append(document.createTextNode(part));
  }
}
function safeMarkdown(text) {
  const root = document.createElement("div");
  root.className = "messageBody";
  const lines = String(text || "").split("\n");
  let inCode = false, codeBuffer = [], codeLanguage = "";
  function codeElement() {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeBuffer.join("\n");
    if (codeLanguage) code.dataset.language = codeLanguage;
    pre.append(code);
    root.append(pre);
    const button = document.createElement("button");
    button.className = "miniButton";
    button.textContent = "نسخ الكود";
    button.onclick = () => navigator.clipboard.writeText(code.textContent).then(() => notify("نُسخ الكود.")).catch(() => notify("تعذر النسخ."));
    root.append(button);
    codeBuffer = [];
  }
  for (const line of lines) {
    const fence = /^\s*\`\`\`([\w+-]*)/.exec(line);
    if (fence) {
      if (inCode) codeElement(); else codeLanguage = fence[1];
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }
    let tag = "p", content = line;
    if (/^#{1,3}\s/.test(line)) {
      const count = line.match(/^#+/)[0].length;
      tag = count <= 2 ? "h2" : "h3";
      content = line.replace(/^#+\s*/, "");
    } else if (/^\s*[-*]\s+/.test(line)) {
      tag = "p"; content = "• " + line.replace(/^\s*[-*]\s+/, "");
    }
    const element = document.createElement(tag);
    inlineFormat(element, content);
    root.append(element);
  }
  if (inCode) codeElement();
  return root;
}
function renderMessages(scroll = false) {
  const box = $("messages");
  box.replaceChildren();
  const chat = currentChat();
  const hasMessages = !!chat?.messages?.length;
  $("welcome").hidden = hasMessages;
  if (chat) for (const message of chat.messages) {
    const outer = document.createElement("article");
    outer.className = "message " + (message.role === "assistant" ? "assistant" : "user");
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "assistant" ? "م" : "أنت";
    const content = document.createElement("div");
    content.className = "messageContent";
    const author = document.createElement("div");
    author.className = "author";
    author.textContent = message.role === "assistant" ? "معون AI" : "أنت";
    content.append(author);
    const body = safeMarkdown(message.content || (busy ? "جارٍ التفكير..." : ""));
    content.append(body);
    if (message.images?.length) {
      const imgs = document.createElement("div");
      imgs.className = "imagePreview";
      for (const src of message.images) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "صورة مرفقة";
        imgs.append(img);
      }
      content.append(imgs);
    } else if (message.imageCount) {
      const label = document.createElement("small");
      label.className = "emptyNote";
      label.textContent = "مرفقات الصور لم تُحفظ بعد إعادة تحميل الصفحة.";
      content.append(label);
    }
    if (message.content) {
      const actions = document.createElement("div");
      actions.className = "msgTools";
      const copy = document.createElement("button");
      copy.className = "miniButton";
      copy.textContent = "نسخ";
      copy.onclick = () => navigator.clipboard.writeText(message.content).then(() => notify("نُسخ النص.")).catch(() => notify("تعذر النسخ."));
      actions.append(copy);
      content.append(actions);
    }
    outer.append(avatar, content);
    box.append(outer);
  }
  if (scroll) scrollBottom();
}
function scrollBottom() {
  const el = $("conversation");
  el.scrollTop = el.scrollHeight;
}
function renderKeyOptions() {
  const control = $("keySelect");
  control.replaceChildren();
  if (!keys.length) {
    control.add(new Option("أضف مفتاحًا أولًا", ""));
    selectedKeyId = "";
  } else {
    if (!keys.some(k => k.id === selectedKeyId)) selectedKeyId = keys[0].id;
    for (const key of keys) control.add(new Option((PROVIDERS[key.provider]?.label || key.provider) + " · " + key.name, key.id));
    control.value = selectedKeyId;
  }
  const list = $("keysList");
  list.replaceChildren();
  for (const key of keys) {
    const row = document.createElement("div"); row.className = "keyRow";
    const text = document.createElement("div");
    const strong = document.createElement("strong"); strong.textContent = key.name;
    const small = document.createElement("small");
    small.textContent = PROVIDERS[key.provider]?.label + " · " + (key.saved ? "محفوظ على الجهاز" : "هذه الجلسة فقط");
    text.append(strong, small);
    const use = document.createElement("button");
    use.textContent = "اختيار";
    use.onclick = () => { if (busy) return notify("أوقف الرد قبل تبديل المفتاح."); selectKey(key.id); $("settingsDialog").close(); };
    const del = document.createElement("button");
    del.className = "dangerText"; del.textContent = "حذف";
    del.onclick = () => {
      if (busy || !confirm("حذف المفتاح " + key.name + " من هذا الجهاز؟")) return;
      keys = keys.filter(k => k.id !== key.id);
      if (selectedKeyId === key.id) { selectedKeyId = keys[0]?.id || ""; selectedModel = ""; }
      saveKeys(); renderKeyOptions(); renderModelOptions(); preferences();
    };
    row.append(text, use, del);
    list.append(row);
  }
  if (!keys.length) {
    const msg = document.createElement("p");
    msg.className = "emptyNote"; msg.textContent = "لم تُضف أي مفاتيح بعد.";
    list.append(msg);
  }
  $("keysCount").textContent = "(" + keys.length + ")";
}
function renderModelOptions(models = []) {
  const select = $("modelSelect");
  select.replaceChildren();
  const provider = selectedKey()?.provider;
  const defaults = provider ? [PROVIDERS[provider].model] : [];
  const unique = [...new Set([...defaults, selectedModel, ...models].filter(Boolean))];
  for (const m of unique) select.add(new Option(m, m));
  selectedModel = unique.includes(selectedModel) ? selectedModel : (unique[0] || "");
  select.value = selectedModel;
  $("customModel").value = selectedModel;
  preferences();
}
function selectKey(id) {
  selectedKeyId = id;
  selectedModel = PROVIDERS[selectedKey()?.provider]?.model || "";
  renderKeyOptions(); renderModelOptions(); preferences();
  loadModels();
}
function renderAll() {
  renderChats(); renderMessages(true); renderKeyOptions(); renderModelOptions();
}
function newChat() {
  if (busy) return notify("أوقف الرد الحالي أولًا.");
  const chat = { id: uid(), title: "محادثة جديدة", updated: now(), messages: [] };
  chats.unshift(chat);
  activeChatId = chat.id; saveChats(); renderAll(); closeSidebar(); $("prompt").focus();
}
async function loadModels() {
  const key = selectedKey();
  if (!key) return;
  const currentId = key.id;
  $("refreshModels").disabled = true;
  $("status").textContent = "جلب النماذج...";
  try {
    const response = await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: key.provider, key: key.key }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر جلب النماذج.");
    if (selectedKeyId === currentId) {
      renderModelOptions(Array.isArray(data.models) ? data.models : []);
      $("status").textContent = "جاهز";
      if (!data.models.length) notify("لم يُرجع المزود قائمة نماذج. يمكنك إدخال اسم النموذج يدويًا.");
    }
  } catch (err) {
    if (selectedKeyId === currentId) {
      $("status").textContent = "اختر نموذجًا";
      notify("تعذر تحميل النماذج: " + err.message);
    }
  } finally { $("refreshModels").disabled = false; }
}
function renderFiles() {
  const container = $("attachments");
  container.replaceChildren();
  container.hidden = !pendingFiles.length;
  for (let i = 0; i < pendingFiles.length; i++) {
    const file = pendingFiles[i];
    const card = document.createElement("div"); card.className = "attachment";
    if (file.kind === "image") {
      const img = document.createElement("img"); img.src = file.data; img.alt = "مرفق"; card.append(img);
    }
    const name = document.createElement("span"); name.textContent = file.name; card.append(name);
    const remove = document.createElement("button"); remove.textContent = "✕"; remove.title = "إزالة";
    remove.onclick = () => { pendingFiles.splice(i, 1); renderFiles(); };
    card.append(remove); container.append(card);
  }
}
async function addFiles(files) {
  if (busy) return;
  for (const file of [...files].slice(0, 5)) {
    if (pendingFiles.length >= 5) { notify("الحد الأقصى خمسة ملفات."); break; }
    const image = /^image\/(png|jpeg|webp)$/.test(file.type);
    if (image) {
      if (pendingFiles.filter(f => f.kind === "image").length >= 2) { notify("الحد الأقصى صورتان للرسالة."); continue; }
      if (file.size > 1000000) { notify("صورة أكبر من 1 ميجابايت. اختر صورة أصغر."); continue; }
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
        reader.readAsDataURL(file);
      });
      pendingFiles.push({ name: file.name, kind: "image", data });
    } else if (/\.(txt|md|csv|json|js|ts|tsx|jsx|py|html|css|sql|xml|yaml|yml|log)$/i.test(file.name)) {
      if (file.size > 75000) { notify("الملف النصي كبير جدًا (الحد 75 كيلوبايت)."); continue; }
      const content = await file.text();
      pendingFiles.push({ name: file.name, kind: "text", data: content.slice(0, 15000) });
    } else notify("نوع ملف غير مدعوم: " + file.name);
  }
  renderFiles();
}
function setBusy(value) {
  busy = value;
  $("sendBtn").hidden = value;
  $("stopBtn").hidden = !value;
  $("keySelect").disabled = value;
  $("modelSelect").disabled = value;
  $("refreshModels").disabled = value;
  $("status").textContent = value ? "جارٍ توليد الرد..." : "جاهز";
}
async function sendPrompt() {
  if (busy) return;
  const key = selectedKey();
  if (!key) { $("settingsDialog").showModal(); return notify("أضف مفتاح API أولًا."); }
  if (!selectedModel) return notify("اختر نموذجًا من القائمة.");
  let content = $("prompt").value.trim();
  const images = pendingFiles.filter(f => f.kind === "image").map(f => f.data);
  const texts = pendingFiles.filter(f => f.kind === "text").map(f => "\n\n---\nملف: " + f.name + "\n\`\`\`\n" + f.data + "\n\`\`\`");
  content += texts.join("");
  if (!content && images.length) content = "حلّل الصورة المرفقة.";
  if (!content) return;
  if (content.length > 30000) return notify("الرسالة طويلة. اختصر محتوى المرفقات.");
  if (!activeChatId) newChat();
  const chat = currentChat();
  chat.messages.push({ role: "user", content, images });
  if (chat.messages.length === 1) chat.title = content.replace(/\s+/g, " ").slice(0, 42);
  chat.updated = now();
  chat.messages.push({ role: "assistant", content: "" });
  $("prompt").value = "";
  $("prompt").style.height = "";
  pendingFiles = [];
  renderFiles();
  renderChats(); renderMessages(true);
  setBusy(true);
  const reply = chat.messages[chat.messages.length - 1];
  controller = new AbortController();
  let interrupted = false;
  try {
    const messages = [];
    if (systemPrompt.trim()) messages.push({ role: "system", content: systemPrompt.slice(0, 8000) });
    // Exclude the empty placeholder assistant message.
    const history = chat.messages.slice(0, -1).slice(-24).map(({ role, content, images }) => ({
      role, content: (content || "").slice(0, 30000), ...(images?.length ? { images } : {})
    }));
    messages.push(...history);
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ provider: key.provider, key: key.key, model: selectedModel, messages })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "فشل الطلب (" + response.status + ").");
    }
    if (!response.body) throw new Error("المتصفح لا يدعم قراءة الرد المباشر.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = chunk.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (!data) continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.delta) {
          reply.content += parsed.delta;
          renderMessages(true);
        }
      }
    }
    if (!reply.content) throw new Error("لم يُرجع النموذج محتوى. جرّب نموذجًا آخر.");
  } catch (error) {
    interrupted = error.name === "AbortError";
    if (interrupted) {
      reply.content += reply.content ? "\n\n[تم إيقاف التوليد]" : "[تم إيقاف التوليد]";
    } else {
      reply.content += (reply.content ? "\n\n" : "") + "تعذر إكمال الرد: " + error.message;
      notify(error.message);
    }
  } finally {
    controller = null;
    setBusy(false);
    chat.updated = now();
    saveChats(); renderChats(); renderMessages(true);
    $("prompt").focus();
  }
}
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$("newChat").onclick = newChat;
$("searchChats").oninput = renderChats;
$("menuBtn").onclick = () => { $("sidebar").classList.add("open"); $("overlay").hidden = false; $("overlay").classList.add("visible"); };
$("overlay").onclick = closeSidebar;
for (const id of ["openSettings", "settingsTop"]) $(id).onclick = () => $("settingsDialog").showModal();
$("closeSettings").onclick = () => $("settingsDialog").close();
$("keyForm").onsubmit = event => {
  event.preventDefault();
  if (busy) return notify("أوقف الرد الحالي قبل تغيير المفاتيح.");
  if (keys.length >= 30) return notify("بلغت الحد الأقصى: 30 مفتاحًا.");
  const provider = $("providerInput").value;
  const key = $("keyValue").value.trim();
  if (!PROVIDERS[provider] || key.length < 8 || key.length > 600) return notify("تحقق من المفتاح.");
  if (keys.some(k => k.key === key && k.provider === provider)) return notify("هذا المفتاح موجود بالفعل.");
  const name = $("keyName").value.trim() || (PROVIDERS[provider].label + " " + (keys.length + 1));
  const item = { id: uid(), provider, key, name, saved: $("rememberKey").checked };
  keys.push(item); saveKeys(); selectKey(item.id);
  $("keyValue").value = ""; $("keyName").value = ""; $("rememberKey").checked = false;
  notify("تمت إضافة المفتاح. اختر النموذج وابدأ المحادثة.");
};
$("keySelect").onchange = event => { if (!busy) selectKey(event.target.value); };
$("modelSelect").onchange = event => { selectedModel = event.target.value; $("customModel").value = selectedModel; preferences(); };
$("refreshModels").onclick = loadModels;
$("applyModel").onclick = () => {
  const model = $("customModel").value.trim();
  if (!/^[a-zA-Z0-9._:/-]{1,160}$/.test(model)) return notify("اسم النموذج غير صالح.");
  selectedModel = model; renderModelOptions(); notify("تم اختيار النموذج " + model);
};
$("saveInstructions").onclick = () => { systemPrompt = $("systemPrompt").value.slice(0, 8000); preferences(); notify("تم حفظ التعليمات."); };
$("clearHistory").onclick = () => {
  if (busy) return notify("أوقف الرد الحالي أولًا.");
  if (!confirm("حذف جميع المحادثات نهائيًا من هذا الجهاز؟")) return;
  chats = []; activeChatId = null; saveChats(); renderAll(); $("settingsDialog").close(); notify("تم حذف المحادثات.");
};
$("chatForm").onsubmit = event => { event.preventDefault(); sendPrompt(); };
$("prompt").onkeydown = event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); sendPrompt();
  }
};
$("prompt").oninput = event => {
  const textarea = event.target;
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 190) + "px";
};
$("stopBtn").onclick = () => controller?.abort();
$("fileInput").onchange = async event => {
  try { await addFiles(event.target.files); }
  catch (err) { notify(err.message); }
  event.target.value = "";
};
for (const button of document.querySelectorAll("[data-prompt]")) button.onclick = () => {
  $("prompt").value = button.dataset.prompt;
  $("prompt").focus();
  $("prompt").dispatchEvent(new Event("input"));
};
$("exportChats").onclick = () => {
  download("maaoun-ai-chats-" + new Date().toISOString().slice(0, 10) + ".json",
    JSON.stringify({ exportedAt: now(), chats: chats.map(c => ({ ...c, messages: c.messages.map(m => ({ role: m.role, content: m.content })) })) }, null, 2), "application/json;charset=utf-8");
  notify("تم تصدير المحادثات دون المفاتيح.");
};
$("micBtn").onclick = () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return notify("الإملاء الصوتي غير متاح في هذا المتصفح.");
  const rec = new Recognition();
  rec.lang = document.documentElement.lang || "ar-SA";
  rec.interimResults = false;
  rec.onresult = event => {
    $("prompt").value += (event.results[0][0].transcript || "") + " ";
    $("prompt").dispatchEvent(new Event("input"));
  };
  rec.onerror = event => notify("تعذر تشغيل الإملاء الصوتي: " + event.error);
  try { rec.start(); } catch { notify("تعذر تشغيل الميكروفون."); }
};
$("systemPrompt").value = systemPrompt;
renderAll();
if (selectedKey()) loadModels();
