import 'server-only';

import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

const createMd: ExecutorFn = async (req) => {
  const title = displayTitle(req);
  let content = req.content ?? '';

  // Add title header if not already present
  if (!content.trimStart().startsWith('# ')) {
    content = `# ${title}\n\n${content}`;
  }

  const buffer = Buffer.from(content, 'utf-8');
  return {
    buffer,
    kind: 'md',
    mime: MIME_BY_KIND.md,
    ext: EXT_BY_KIND.md,
  };
};

export default createMd;
