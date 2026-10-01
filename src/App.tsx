import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Ellipsis, Menu, MessageSquare, Moon, PanelLeftClose, Plus, Settings2, Sparkles, Square, Sun, X } from 'lucide-react';
import { Markdown } from './components/Markdown';
import { SettingsPanel } from './components/SettingsPanel';
import { runAgent } from './lib/agent';
import { clearAllData, loadApiKey, loadChats, loadSettings, saveApiKey, saveChats, saveSettings } from './lib/storage';
import { DEFAULT_SETTINGS, modelLabel, type AgentStep, type Conversation, type Message, type Settings } from './lib/types';

const strings = {
  ar: { newChat: 'محادثة جديدة', history: 'محادثاتك', noHistory: 'محادثاتك القادمة ستظهر هنا', settings: 'الإعدادات', options: 'خيارات المحادثة', intro: 'مساحة أوسع لأفكارك.', sub: 'اسأل، استكشف، أو أنجز مهمة. سَيا معك في كل خطوة.', placeholder: 'اكتب رسالتك هنا...', disclaimer: 'قد يرتكب الذكاء الاصطناعي أخطاء. تحقق من المعلومات المهمة.', analyzing: 'يحلل الطلب...', executing: 'ينفذ الخطوة...', processing: 'يعالج النتيجة...', writing: 'يكتب الإجابة...', copy: 'نسخ', copied: 'تم النسخ', rename: 'إعادة تسمية', remove: 'حذف', stop: 'إيقاف التوليد', send: 'إرسال الرسالة', sidebar: 'فتح القائمة', closeSidebar: 'إغلاق القائمة', scroll: 'الانتقال للأسفل', tools: 'خطوات الوكيل', noKey: 'أضف مفتاح Google AI Studio من الإعدادات للبدء.', stopped: 'تم إيقاف التوليد.', stepLimit: 'وصل الوكيل إلى الحد الأقصى للخطوات. حاول تقسيم المهمة.', rate: 'تم بلوغ حد الطلبات. انتظر قليلًا ثم حاول مجددًا.', auth: 'المفتاح غير صالح أو لا يملك صلاحية الوصول إلى النموذج. تحقق من الإعدادات.', model: 'النموذج غير متاح لمفتاحك. جرّب نموذجًا آخر من الإعدادات.', blocked: 'أوقف فلتر السلامة توليد الإجابة. جرّب إعادة صياغة طلبك.', switched: 'النموذج المحدد غير متاح لمفتاحك، لذا تم التبديل تلقائيًا إلى {model}.', network: 'تعذّر الاتصال بـ Google. تحقق من الإنترنت أو قيود المتصفح ثم حاول مجددًا.', generic: 'حدث خطأ أثناء إنشاء الإجابة.', retry: 'يمكنك إعادة المحاولة.', suggestions: ['اشرح لي فكرة معقدة ببساطة', 'ساعدني في صياغة رسالة احترافية', 'احسب لي مسألة رياضية'], today: 'اليوم', yesterday: 'أمس', older: 'سابقًا', language: 'English', keyHint: 'مفتاحك يُرسل إلى Google فقط', deleteConfirm: 'حذف هذه المحادثة؟', storageFull: 'امتلأت مساحة التخزين المحلية. احذف بعض المحادثات لتحفظ الجديدة.' },
  en: { newChat: 'New conversation', history: 'Your conversations', noHistory: 'Your conversations will appear here', settings: 'Settings', options: 'Conversation options', intro: 'Make room for what’s next.', sub: 'Ask, explore, or get something done. Saya is here for every step.', placeholder: 'Ask anything...', disclaimer: 'AI can make mistakes. Check important information.', analyzing: 'Analyzing request...', executing: 'Running a tool...', processing: 'Processing result...', writing: 'Writing response...', copy: 'Copy', copied: 'Copied', rename: 'Rename', remove: 'Delete', stop: 'Stop generating', send: 'Send message', sidebar: 'Open menu', closeSidebar: 'Close menu', scroll: 'Scroll to bottom', tools: 'Agent steps', noKey: 'Add your Google AI Studio key in Settings to get started.', stopped: 'Generation stopped.', stepLimit: 'The agent reached its step limit. Try splitting up the task.', rate: 'Rate limit reached. Wait a moment and try again.', auth: 'Invalid key or this model is not accessible. Check Settings.', model: 'This model is not available for your key. Try another model in Settings.', blocked: 'Safety filters stopped the response. Try rephrasing your request.', switched: 'The selected model is not available for your key, so Saya switched to {model} automatically.', network: 'Could not connect to Google. Check your connection or browser restrictions.', generic: 'Something went wrong while generating.', retry: 'You can try again.', suggestions: ['Explain a complex idea simply', 'Help me write a professional email', 'Calculate a math problem'], today: 'Today', yesterday: 'Yesterday', older: 'Earlier', language: 'العربية', keyHint: 'Your key is sent only to Google', deleteConfirm: 'Delete this conversation?', storageFull: 'Local storage is full. Delete some conversations to save new ones.' },
};

function errorText(error: unknown, t: typeof strings.ar): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'RATE_LIMIT') return t.rate;
  if (message.startsWith('AUTH_ERROR')) return t.auth;
  if (message.startsWith('BLOCKED')) return t.blocked;
  if (message.startsWith('MODEL_ERROR')) return t.model;
  if (message === 'STEP_LIMIT') return t.stepLimit;
  if (error instanceof TypeError || message === 'STREAM_UNAVAILABLE') return t.network;
  return `${t.generic} ${message && !message.includes('key=') ? `(${message.slice(0, 200)})` : ''} ${t.retry}`;
}

function groupName(timestamp: number, t: typeof strings.ar) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (timestamp >= start.getTime()) return t.today;
  if (timestamp >= start.getTime() - 86400000) return t.yesterday;
  return t.older;
}

// Removes UI-only error lines and empty assistant messages before sending history to the model.
function cleanHistory(messages: Message[]): Message[] {
  return messages
    .map(m => m.role === 'assistant' ? { ...m, text: m.text.replace(/(\n\n)?> [^\n]*$/, '').trim() } : m)
    .filter(m => m.role === 'user' || m.text.length > 0);
}

function BrandMark({ size = 22 }: { size?: number }) { return <span className="brand-mark"><Sparkles size={size} strokeWidth={1.8} /></span>; }

function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="message-action" title={label} aria-label={label} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* Clipboard unavailable. */ } }}>{copied ? <Check size={15} /> : <Copy size={15} />}<span>{copied ? copiedLabel : label}</span></button>;
}

export default function App() {
  const [chats, setChats] = useState<Conversation[]>(loadChats);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<keyof Pick<typeof strings.ar, 'analyzing' | 'executing' | 'processing' | 'writing'>>('analyzing');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(true);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [showScroll, setShowScroll] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const cancelRename = useRef(false);
  const t = strings[settings.language];
  const active = chats.find(chat => chat.id === activeId);
  const busy = generatingId !== null;
  const busyHere = generatingId !== null && generatingId === activeId;

  useEffect(() => { document.documentElement.lang = settings.language; document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr'; document.title = settings.language === 'ar' ? 'سَيا | مساعدك الذكي' : 'Saya | Your AI assistant'; document.documentElement.dataset.theme = settings.theme; saveSettings(settings); }, [settings]);
  useEffect(() => { saveApiKey(apiKey.trim(), settings.rememberKey); }, [apiKey, settings.rememberKey]);
  useEffect(() => { const timer = window.setTimeout(() => { try { saveChats(chats); } catch { setNotice(strings[settings.language].storageFull); } }, 300); return () => window.clearTimeout(timer); }, [chats, settings.language]);
  useEffect(() => { if (stickToBottom.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: busyHere ? 'auto' : 'smooth' }); }, [active?.messages, busyHere, activeId]);
  useEffect(() => { if (!settingsOpen) return; const keydown = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); }; window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown); }, [settingsOpen]);
  // Close the conversation menu when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!menuId) return;
    const down = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.history-menu, .history-more')) setMenuId(null); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenuId(null); };
    document.addEventListener('mousedown', down); window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [menuId]);
  // Abort any running request when the component unmounts.
  useEffect(() => () => controller.current?.abort(), []);

  function updateChat(id: string, update: (chat: Conversation) => Conversation) { setChats(prev => prev.map(chat => chat.id === id ? update(chat) : chat)); }
  function updateMessage(chatId: string, messageId: string, update: (message: Message) => Message) { updateChat(chatId, chat => ({ ...chat, updatedAt: Date.now(), messages: chat.messages.map(message => message.id === messageId ? update(message) : message) })); }
  function newChat() { setActiveId(null); setDraft(''); setSidebarOpen(false); setMenuId(null); stickToBottom.current = true; window.setTimeout(() => composer.current?.focus(), 40); }
  function selectChat(id: string) { setActiveId(id); setSidebarOpen(false); setMenuId(null); stickToBottom.current = true; }
  function deleteChat(id: string) {
    if (!window.confirm(t.deleteConfirm)) return;
    if (generatingId === id) controller.current?.abort();
    setChats(prev => prev.filter(chat => chat.id !== id));
    if (activeId === id) setActiveId(null);
    setMenuId(null);
  }
  function startRename(chat: Conversation) { cancelRename.current = false; setEditingId(chat.id); setEditingTitle(chat.title); setMenuId(null); }
  function finishRename(id: string) {
    if (cancelRename.current) { cancelRename.current = false; return; }
    const title = editingTitle.trim();
    if (title) updateChat(id, chat => ({ ...chat, title }));
    setEditingId(null);
  }

  async function send(value = draft) {
    const text = value.trim();
    if (!text || busyRef.current) return;
    if (!apiKey.trim()) { setSettingsOpen(true); setNotice(t.noKey); return; }
    const chatId = activeId || crypto.randomUUID();
    busyRef.current = true; setGeneratingId(chatId); setStatus('analyzing'); setNotice(''); setDraft(''); stickToBottom.current = true;
    const user: Message = { id: crypto.randomUUID(), role: 'user', text, createdAt: Date.now() };
    const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', text: '', createdAt: Date.now(), steps: [] };
    const previous = cleanHistory(chats.find(chat => chat.id === chatId)?.messages || []);
    if (!activeId) { setChats(prev => [{ id: chatId, title: Array.from(text.replace(/\s+/g, ' ')).slice(0, 45).join(''), messages: [user, assistant], createdAt: Date.now(), updatedAt: Date.now() }, ...prev]); setActiveId(chatId); }
    else updateChat(chatId, chat => ({ ...chat, updatedAt: Date.now(), messages: [...chat.messages, user, assistant] }));
    const abort = new AbortController(); controller.current = abort;
    try {
      await runAgent([...previous, user], settings, apiKey.trim(), abort.signal, {
        onStatus: next => setStatus(next),
        onText: output => updateMessage(chatId, assistant.id, message => ({ ...message, text: output })),
        onStep: (step: AgentStep) => updateMessage(chatId, assistant.id, message => ({ ...message, steps: [...(message.steps || []), step] })),
        onModelFallback: model => {
          // Persist the working model so later messages use it directly.
          setSettings(prev => prev.model === model ? prev : { ...prev, model });
          setNotice(t.switched.replace('{model}', modelLabel(model)));
        },
      });
    } catch (error) {
      if (!abort.signal.aborted) console.error(error);
      const message = abort.signal.aborted ? t.stopped : errorText(error, t);
      updateMessage(chatId, assistant.id, item => ({ ...item, text: item.text ? `${item.text}\n\n> ${message}` : `> ${message}` }));
    } finally { controller.current = null; busyRef.current = false; setGeneratingId(null); }
  }
  function onSubmit(event: FormEvent) { event.preventDefault(); void send(); }
  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }
  function onScroll() { const el = scroller.current; if (!el) return; const near = el.scrollHeight - el.scrollTop - el.clientHeight < 130; stickToBottom.current = near; setShowScroll(!near); }
  function clearData() {
    controller.current?.abort();
    setChats([]); setActiveId(null); setApiKey(''); setSettings(DEFAULT_SETTINGS); setSettingsOpen(false); setNotice('');
    // Wipe storage after the effects above have re-written their defaults / debounced saves.
    window.setTimeout(() => clearAllData(), 450);
  }
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  let lastGroup = '';

  return <div className="app-shell">
    {sidebarOpen && <div className="mobile-scrim" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${!desktopSidebar ? 'desktop-hidden' : ''}`}>
      <div className="side-top"><button className="sidebar-brand" onClick={newChat} aria-label="Saya"><BrandMark /><span>{settings.language === 'ar' ? 'سَيا' : 'saya'}<small>AI AGENT</small></span></button><button className="icon-button sidebar-close" onClick={() => { setSidebarOpen(false); setDesktopSidebar(false); }} aria-label={t.closeSidebar}><PanelLeftClose size={19} /></button></div>
      <button className="new-chat" onClick={newChat}><Plus size={19} strokeWidth={1.8} /><span>{t.newChat}</span><span className="new-shortcut">+</span></button>
      <div className="history-heading">{t.history}<span>{chats.length ? String(chats.length).padStart(2, '0') : ''}</span></div>
      <div className="history-list">{!sorted.length && <p className="history-empty">{t.noHistory}</p>}{sorted.map(chat => {
        const group = groupName(chat.updatedAt, t);
        const showGroup = group !== lastGroup; lastGroup = group;
        return <div key={chat.id}>{showGroup && <div className="history-group">{group}</div>}<div className={`history-item ${activeId === chat.id ? 'active' : ''}`}>
          {editingId === chat.id
            ? <div className="history-select"><MessageSquare size={16} strokeWidth={1.7} /><input className="rename-input" autoFocus value={editingTitle} onChange={e => setEditingTitle(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) finishRename(chat.id); if (e.key === 'Escape') { cancelRename.current = true; setEditingId(null); } }} onBlur={() => finishRename(chat.id)} /></div>
            : <button className="history-select" onClick={() => selectChat(chat.id)}><MessageSquare size={16} strokeWidth={1.7} /><span dir="auto">{chat.title}</span></button>}
          <button className="history-more" aria-label={t.options} aria-expanded={menuId === chat.id} onClick={() => setMenuId(menuId === chat.id ? null : chat.id)}><Ellipsis size={17} /></button>
          {menuId === chat.id && <div className="history-menu"><button onClick={() => startRename(chat)}>{t.rename}</button><button className="delete" onClick={() => deleteChat(chat.id)}>{t.remove}</button></div>}
        </div></div>;
      })}</div>
      <div className="side-bottom"><button onClick={() => setSettingsOpen(true)}><Settings2 size={18} /><span>{t.settings}</span></button><div className="side-footnote"><span className="online-dot" />{t.keyHint}</div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="topbar-start"><button className="icon-button sidebar-toggle" onClick={() => { if (window.innerWidth <= 850) setSidebarOpen(true); else setDesktopSidebar(!desktopSidebar); }} aria-label={t.sidebar}><Menu size={21} /></button><span className="topbar-divider" /><button className="model-name" onClick={() => setSettingsOpen(true)}><span>Saya</span><span className="model-secondary">/ {modelLabel(settings.model)}</span><ChevronDown size={15} /></button></div><div className="topbar-actions"><button className="text-switch" onClick={() => setSettings(prev => ({ ...prev, language: prev.language === 'ar' ? 'en' : 'ar' }))}>{t.language}</button><button className="icon-button" title={settings.theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label={settings.theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => setSettings(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}>{settings.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button><button className="icon-button mobile-settings" title={t.settings} aria-label={t.settings} onClick={() => setSettingsOpen(true)}><Settings2 size={19} /></button></div></header>

      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {!active ? <div className="welcome"><div className="welcome-inner"><div className="welcome-symbol"><BrandMark size={30} /></div><p className="welcome-eyebrow">YOUR SPACE TO THINK</p><h1>{settings.language === 'ar' ? <>أهلًا، أنا <em>سَيا.</em></> : <>Hello, I’m <em>Saya.</em></>}</h1><h2>{t.intro}</h2><p className="welcome-sub">{t.sub}</p><div className="suggestions">{t.suggestions.map(suggestion => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}<ArrowUp size={14} /></button>)}</div></div><div className="welcome-decoration" aria-hidden="true">S</div></div> : <div className="conversation" key={active.id}>{active.messages.map((message, index) => {
          const isLast = index === active.messages.length - 1;
          return <article className={`message ${message.role}`} key={message.id}>
            {message.role === 'assistant' && <div className="assistant-avatar"><BrandMark size={17} /></div>}
            <div className="message-main">{message.role === 'user' ? <div className="user-bubble" dir="auto">{message.text}</div> : <>
              {message.steps && message.steps.length > 0 && <details className="agent-steps"><summary><span className="steps-icon"><Sparkles size={14} /></span>{t.tools} <span className="step-count">{message.steps.length}</span><ChevronDown size={15} /></summary><div className="steps-list">{message.steps.map((step, i) => <div className="step-entry" key={i}><span className={`step-marker ${step.ok ? '' : 'failed'}`} /> <div><strong>{step.tool}</strong><span dir="auto">{step.summary}</span><code dir="ltr">{step.result}</code></div></div>)}</div></details>}
              {message.text ? <Markdown text={message.text} copyLabel={t.copy} /> : busyHere && isLast ? <div className="thinking"><span className="thinking-dots"><i /><i /><i /></span>{t[status]}</div> : null}
              {busyHere && isLast && message.text && <div className="streaming-line"><span className="streaming-cursor" />{t[status]}</div>}
              {message.text && !(busyHere && isLast) && <div className="message-actions"><CopyButton text={message.text} label={t.copy} copiedLabel={t.copied} /></div>}
            </>}</div>
          </article>;
        })}</div>}
      </div>

      {showScroll && active && <button className="scroll-bottom" onClick={() => { stickToBottom.current = true; scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }} aria-label={t.scroll}><ArrowDown size={18} /></button>}
      <div className="composer-region">{notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}<form className="composer" onSubmit={onSubmit}><textarea ref={composer} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onComposerKey} placeholder={t.placeholder} rows={2} dir="auto" aria-label={t.placeholder} /><div className="composer-bottom"><span className="composer-hint">{settings.language === 'ar' ? 'Enter للإرسال  ·  Shift + Enter لسطر جديد' : 'Enter to send  ·  Shift + Enter for a new line'}</span>{busy ? <button type="button" className="send-button stop-button" onClick={() => controller.current?.abort()} aria-label={t.stop} title={t.stop}><Square size={14} fill="currentColor" /></button> : <button className="send-button" type="submit" disabled={!draft.trim()} aria-label={t.send} title={t.send}><ArrowUp size={19} strokeWidth={2.2} /></button>}</div></form><div className="composer-disclaimer">{t.disclaimer}</div></div>
    </main>
    {settingsOpen && <SettingsPanel settings={settings} apiKey={apiKey} onSettings={setSettings} onKey={setApiKey} onClose={() => setSettingsOpen(false)} onClear={clearData} />}
  </div>;
}
