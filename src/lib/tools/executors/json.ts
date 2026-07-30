import 'server-only';

import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND } from '../types';

const createJson: ExecutorFn = async (req) => {
  let data = req.data ?? req.content ?? '';

  // A string that *looks* like JSON is meant to BE JSON, so a parse failure is a
  // real error rather than something to swallow. Keeping it as a string produced
  // a .json file containing a quoted blob (`"{\"total\": 42,}"`) and a 200 OK,
  // so the UI offered a successful-looking download of the wrong thing.
  if (typeof data === 'string' && /^\s*[[{]/.test(data)) {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new Error(
        `The content isn't valid JSON: ${err instanceof Error ? err.message : 'parse failed'}`,
      );
    }
  }

  const json = JSON.stringify(data, null, 2);
  const buffer = Buffer.from(json, 'utf-8');
  return {
    buffer,
    kind: 'json',
    mime: MIME_BY_KIND.json,
    ext: EXT_BY_KIND.json,
  };
};

export default createJson;
