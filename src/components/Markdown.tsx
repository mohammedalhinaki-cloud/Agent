import { createElement, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownProps {
  text: string;
  copyLabel: string;
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string; language: string };

function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) segments.push({ type: 'text', value: text.slice(last, match.index) });
    segments.push({ type: 'code', language: (match[1] || '').trim(), value: match[2].replace(/\n$/, '') });
    last = fence.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[2]) nodes.push(<strong key={match.index}>{match[2]}</strong>);
    else if (match[3]) nodes.push(<code key={match.index}>{match[3]}</code>);
    else if (match[4] && match[5]) nodes.push(<a key={match.index} href={match[5]} target="_blank" rel="noreferrer">{match[4]}</a>);
    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isBlockStart(line: string): boolean {
  return /^(#{1,6}\s+|>\s?|[-*]\s+|\d+[.)]\s+)/.test(line.trim());
}

function renderText(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i += 1; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      nodes.push(createElement(`h${heading[1].length}`, { key: `${keyPrefix}-h-${i}` }, renderInline(heading[2])));
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      nodes.push(<blockquote key={`${keyPrefix}-q-${i}`}>{renderInline(quote.join(' '))}</blockquote>);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      nodes.push(<ul key={`${keyPrefix}-ul-${i}`}>{items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''));
        i += 1;
      }
      nodes.push(<ol key={`${keyPrefix}-ol-${i}`}>{items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !isBlockStart(lines[i]))) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    nodes.push(<p key={`${keyPrefix}-p-${i}`}>{renderInline(paragraph.join(' '))}</p>);
  }

  return nodes;
}

function CodeBlock({ code, language, copyLabel }: { code: string; language: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* Clipboard unavailable. */ }
  }

  return <div className="code-block">
    <div className="code-head"><span>{language || 'code'}</span><button type="button" onClick={copy} aria-label={copyLabel}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
    <pre dir="ltr"><code>{code}</code></pre>
  </div>;
}

export function Markdown({ text, copyLabel }: MarkdownProps) {
  return <div className="markdown" dir="auto">
    {splitSegments(text).map((segment, index) => segment.type === 'code'
      ? <CodeBlock key={index} code={segment.value} language={segment.language} copyLabel={copyLabel} />
      : renderText(segment.value, String(index)))}
  </div>;
}
