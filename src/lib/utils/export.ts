import type { Conversation } from '@/types';

/** Serialize a conversation to a clean Markdown transcript. */
export function conversationToMarkdown(convo: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${convo.title || 'Conversation'}`);
  lines.push('');
  lines.push(`> Model: \`${convo.model}\`  •  Exported: ${new Date().toLocaleString()}`);
  if (convo.systemPrompt.trim()) {
    lines.push('');
    lines.push('## System Prompt');
    lines.push('');
    lines.push('```');
    lines.push(convo.systemPrompt.trim());
    lines.push('```');
  }
  lines.push('');
  lines.push('---');
  for (const m of convo.messages) {
    if (m.role === 'system') continue;
    const who = m.role === 'user' ? '🧑 User' : '🤖 Assistant';
    lines.push('');
    lines.push(`### ${who}`);
    if (m.attachments?.length) {
      lines.push('');
      lines.push(`*Attachments: ${m.attachments.map((a) => a.name).join(', ')}*`);
    }
    lines.push('');
    lines.push(m.content.trim() || '_(empty)_');
  }
  lines.push('');
  return lines.join('\n');
}

/** Serialize a conversation to pretty JSON. */
export function conversationToJson(convo: Conversation): string {
  return JSON.stringify(convo, null, 2);
}

/** Trigger a browser download of a text blob. Guards against SSR. */
export function downloadText(filename: string, content: string, mime = 'text/plain'): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      // Unicode letters/digits, not `a-z0-9`: an ASCII-only class replaced every
      // character of a Japanese or Cyrillic title, so every such chat exported
      // as "conversation.md" — a download folder of conversation(1), (2), (3).
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .slice(0, 48)
      // After the cut, so a truncation landing on a separator doesn't keep it.
      .replace(/^-+|-+$/g, '') || 'conversation'
  );
}
