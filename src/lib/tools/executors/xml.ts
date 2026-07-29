import 'server-only';

import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Coerce an arbitrary object key into a valid XML element name (NCName). Keys
 * like "First Name", "2024", or "total$" would otherwise produce malformed XML
 * that no parser will open. Invalid characters become underscores; a leading
 * digit/punct gets an underscore prefix.
 */
function tagName(key: string): string {
  let name = key.trim().replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!name || !/^[A-Za-z_]/.test(name)) name = `_${name}`;
  return name;
}

/** Singularize a wrapper name for its array items (Items → Item, else <item>). */
function itemName(key: string): string {
  const singular = key.replace(/ies$/i, 'y').replace(/s$/i, '');
  return tagName(singular || 'item');
}

function nodeToXml(key: string, value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const tag = tagName(key);

  if (value === null || value === undefined) return `${pad}<${tag}/>`;

  if (Array.isArray(value)) {
    const child = itemName(key);
    const items = value.map((v) => nodeToXml(child, v, indent + 1)).join('\n');
    return `${pad}<${tag}>\n${items}\n${pad}</${tag}>`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}<${tag}/>`;
    const inner = entries.map(([k, v]) => nodeToXml(k, v, indent + 1)).join('\n');
    return `${pad}<${tag}>\n${inner}\n${pad}</${tag}>`;
  }

  return `${pad}<${tag}>${escapeXml(String(value))}</${tag}>`;
}

const createXml: ExecutorFn = async (req) => {
  let data: unknown = req.data ?? req.content ?? '';
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      /* keep as plain string — emitted as text inside the root element */
    }
  }

  const root = tagName(displayTitle(req));
  let inner: string;
  if (data !== null && typeof data === 'object') {
    inner = Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => nodeToXml(k, v, 1))
      .join('\n');
    if (Array.isArray(data)) {
      inner = data.map((v) => nodeToXml('item', v, 1)).join('\n');
    }
  } else {
    inner = `  ${escapeXml(String(data))}`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>\n${inner}\n</${root}>\n`;
  const buffer = Buffer.from(xml, 'utf-8');
  return { buffer, kind: 'xml', mime: MIME_BY_KIND.xml, ext: EXT_BY_KIND.xml };
};

export default createXml;
