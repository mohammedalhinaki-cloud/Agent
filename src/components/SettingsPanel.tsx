import { useState, type Dispatch, type SetStateAction } from 'react';
import { ExternalLink, Eye, EyeOff, RotateCcw, Trash2, X } from 'lucide-react';
import { DEFAULT_SETTINGS, MODEL_OPTIONS, type Settings } from '../lib/types';

interface SettingsPanelProps {
  settings: Settings;
  apiKey: string;
  onSettings: Dispatch<SetStateAction<Settings>>;
  onKey: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onClear: () => void;
}

const labels = {
  ar: {
    title: 'الإعدادات',
    subtitle: 'اضبط سَيا ومفتاح Google AI Studio الخاص بك.',
    apiKey: 'مفتاح Google AI Studio',
    apiPlaceholder: 'AIza...',
    getKey: 'الحصول على مفتاح',
    remember: 'تذكّر المفتاح في هذا المتصفح',
    rememberHint: 'إذا ألغيت الخيار سيُحفظ مؤقتًا في هذه الجلسة فقط.',
    model: 'النموذج',
    modelHint: 'إن كان النموذج المختار غير متاح لمفتاحك، سيعيد سَيا المحاولة تلقائيًا مع Gemini Flash (الأحدث). نماذج 2.5 متاحة فقط للمفاتيح التي استخدمتها سابقًا.',
    language: 'لغة الواجهة',
    theme: 'المظهر',
    dark: 'داكن',
    light: 'فاتح',
    temperature: 'الإبداع',
    maxTokens: 'الحد الأقصى للإجابة',
    systemPrompt: 'تعليمات المساعد',
    reset: 'استعادة الافتراضيات',
    clear: 'حذف كل البيانات',
    clearConfirm: 'سيتم حذف المحادثات والإعدادات والمفتاح من هذا المتصفح. متابعة؟',
    close: 'إغلاق',
    show: 'إظهار المفتاح',
    hide: 'إخفاء المفتاح',
    safe: 'يبقى المفتاح في متصفحك ولا يُرسل إلا إلى Google عند طلب الإجابة.',
  },
  en: {
    title: 'Settings',
    subtitle: 'Tune Saya and add your Google AI Studio key.',
    apiKey: 'Google AI Studio key',
    apiPlaceholder: 'AIza...',
    getKey: 'Get a key',
    remember: 'Remember key in this browser',
    rememberHint: 'When disabled, the key is kept only for this browser session.',
    model: 'Model',
    modelHint: 'If the selected model is unavailable for your key, Saya automatically retries with Gemini Flash (Latest). The 2.5 models only work for keys that already used them.',
    language: 'Interface language',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    temperature: 'Creativity',
    maxTokens: 'Maximum answer length',
    systemPrompt: 'Assistant instructions',
    reset: 'Restore defaults',
    clear: 'Delete all data',
    clearConfirm: 'This will delete conversations, settings, and the key from this browser. Continue?',
    close: 'Close',
    show: 'Show key',
    hide: 'Hide key',
    safe: 'Your key stays in your browser and is sent only to Google when generating an answer.',
  },
};

export function SettingsPanel({ settings, apiKey, onSettings, onKey, onClose, onClear }: SettingsPanelProps) {
  const [showKey, setShowKey] = useState(false);
  const t = labels[settings.language];

  function clear() {
    if (window.confirm(t.clearConfirm)) onClear();
  }

  return <div className="settings-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" dir={settings.language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="settings-header">
        <div>
          <h2 id="settings-title">{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t.close}><X size={20} /></button>
      </div>

      <div className="settings-body">
        <label className="field-label" htmlFor="api-key">{t.apiKey}</label>
        <div className="key-row">
          <input
            id="api-key"
            className="settings-input"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={event => onKey(event.target.value)}
            placeholder={t.apiPlaceholder}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="icon-button ghost" type="button" onClick={() => setShowKey(value => !value)} aria-label={showKey ? t.hide : t.show} title={showKey ? t.hide : t.show}>{showKey ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
        <div className="settings-inline">
          <label className="checkbox-row">
            <input type="checkbox" checked={settings.rememberKey} onChange={event => onSettings(prev => ({ ...prev, rememberKey: event.target.checked }))} />
            <span>{t.remember}</span>
          </label>
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">{t.getKey}<ExternalLink size={14} /></a>
        </div>
        <p className="settings-help">{t.safe} {t.rememberHint}</p>

        <div className="settings-grid">
          <label>
            <span>{t.model}</span>
            <select value={settings.model} onChange={event => onSettings(prev => ({ ...prev, model: event.target.value }))}>
              {MODEL_OPTIONS.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
            </select>
          </label>
          <label>
            <span>{t.language}</span>
            <select value={settings.language} onChange={event => onSettings(prev => ({ ...prev, language: event.target.value as Settings['language'] }))}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span>{t.theme}</span>
            <select value={settings.theme} onChange={event => onSettings(prev => ({ ...prev, theme: event.target.value as Settings['theme'] }))}>
              <option value="dark">{t.dark}</option>
              <option value="light">{t.light}</option>
            </select>
          </label>
          <label>
            <span>{t.maxTokens}</span>
            <input type="number" min={256} max={8192} step={256} value={settings.maxOutputTokens} onChange={event => onSettings(prev => ({ ...prev, maxOutputTokens: Number(event.target.value) }))} />
          </label>
        </div>
        <p className="settings-help">{t.modelHint}</p>

        <label className="range-label">
          <span>{t.temperature}: <strong>{settings.temperature.toFixed(1)}</strong></span>
          <input type="range" min={0} max={2} step={0.1} value={settings.temperature} onChange={event => onSettings(prev => ({ ...prev, temperature: Number(event.target.value) }))} />
        </label>

        <label className="field-label" htmlFor="system-prompt">{t.systemPrompt}</label>
        <textarea
          id="system-prompt"
          className="settings-textarea"
          value={settings.systemPrompt}
          onChange={event => onSettings(prev => ({ ...prev, systemPrompt: event.target.value }))}
          rows={4}
          dir="auto"
        />
      </div>

      <div className="settings-footer">
        <button className="secondary-button" type="button" onClick={() => onSettings(prev => ({ ...DEFAULT_SETTINGS, language: prev.language, theme: prev.theme }))}><RotateCcw size={16} />{t.reset}</button>
        <button className="danger-button" type="button" onClick={clear}><Trash2 size={16} />{t.clear}</button>
      </div>
    </section>
  </div>;
}
