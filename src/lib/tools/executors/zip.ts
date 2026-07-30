import 'server-only';

import JSZip from 'jszip';
import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND } from '../types';

const zipProject: ExecutorFn = async (req) => {
  const zip = new JSZip();
  const files = req.files ?? [];

  for (const file of files) {
    // Normalize segment-wise rather than pattern-stripping. The old single pass
    // (`.replace(/^[/\\]+/,'').replace(/\.\.[/\\]/g,'')`) missed overlapping
    // sequences — "....//....//home/x" survived as "../../home/x" — and left a
    // Windows drive prefix ("C:\Windows\evil.dll") completely intact.
    const path = String(file?.path ?? '')
      .split(/[/\\]+/)
      .filter((seg) => seg && seg !== '.' && seg !== '..' && !/^[a-zA-Z]:$/.test(seg))
      .join('/');
    if (path) zip.file(path, file.content ?? '');
  }

  if (files.length === 0) {
    zip.file('README.md', req.content ?? '# Project\n\nEmpty project.');
  }

  // DEFLATE compression — the previous default stored files uncompressed, so a
  // text-heavy bundle was needlessly large.
  const buffer = Buffer.from(
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }),
  );
  return { buffer, kind: 'zip', mime: MIME_BY_KIND.zip, ext: EXT_BY_KIND.zip };
};

export default zipProject;
