/**
 * Exercises the pieces of `fetch_url` that must not be wrong: the SSRF guard
 * (including the bypasses a single up-front check misses) and the HTML→text
 * conversion. Ends with one live fetch as a smoke test.
 *
 * Run: node scripts/verify-fetch-url.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: {
    '@': `${ROOT}/src`,
    // `server-only` is supplied by the Next compiler, not resolvable from plain
    // node. Its `empty.js` is the no-op variant Next aliases in on the server.
    'server-only': `${ROOT}/node_modules/next/dist/compiled/server-only/empty.js`,
  },
  interopDefault: true,
  esmResolve: true,
});

const { assertPublicUrl, blockedAddress, BlockedUrlError } = jiti(
  `${ROOT}/src/lib/server/public-url.ts`,
);
const fetchUrl = jiti(`${ROOT}/src/lib/tools/executors/fetch-url.ts`);

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n         got  ${g}\n         want ${w}`);
  }
};
/** Resolves to true when the URL is refused. */
const refused = async (url, opts) => {
  try {
    await assertPublicUrl(url, opts ?? { allowQuery: true, allowHttp: true });
    return false;
  } catch (err) {
    return err instanceof BlockedUrlError;
  }
};

console.log('\n1. literal private and reserved addresses');
for (const ip of [
  '127.0.0.1',
  '10.0.0.1',
  '172.16.5.4',
  '192.168.1.1',
  '169.254.169.254', // cloud metadata — the first thing an SSRF probe tries
  '0.0.0.0',
  '100.64.0.1', // carrier NAT
  '198.18.0.1',
  '224.0.0.1',
  '::1',
  'fe80::1',
  'fc00::1',
  '::ffff:127.0.0.1', // IPv4-mapped loopback
]) {
  eq(`blockedAddress(${ip})`, blockedAddress(ip), true);
}
eq('a public v4 address is allowed', blockedAddress('93.184.216.34'), false);
eq('a public v6 address is allowed', blockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
eq('garbage counts as blocked', blockedAddress('not-an-ip'), true);

console.log('\n2. URL-level refusals');
eq('loopback by IP', await refused('http://127.0.0.1/'), true);
eq('metadata endpoint', await refused('http://169.254.169.254/latest/meta-data/'), true);
eq('localhost by name', await refused('http://localhost:3000/'), true);
eq('a .internal name', await refused('https://db.internal/'), true);
eq('a .local name', await refused('https://printer.local/'), true);
eq(
  'credentials in the URL (authority smuggling)',
  await refused('https://evil.com@127.0.0.1/'),
  true,
);
eq('a non-http scheme', await refused('file:///etc/passwd'), true);
eq('a data: URL', await refused('data:text/html,hi'), true);
eq('empty input', await refused(''), true);
eq('nonsense input', await refused('not a url'), true);
eq(
  'http is refused when only https is allowed',
  await refused('http://example.com/', { allowHttp: false, allowQuery: true }),
  true,
);
eq(
  'a query is refused when the caller forbids it (provider endpoints)',
  await refused('https://example.com/?a=1', { allowQuery: false, allowHttp: true }),
  true,
);

console.log('\n3. URLs that must be allowed');
eq('a plain https page', await refused('https://example.com/'), false);
eq('https with a query and fragment', await refused('https://example.com/a?b=1#c'), false);
eq('http when permitted', await refused('http://example.com/'), false);

console.log('\n4. the executor rejects unusable input before any network call');
const throws = async (req) => {
  try {
    await fetchUrl(req);
    return null;
  } catch (err) {
    return err.message;
  }
};
eq('no url at all', (await throws({ tool: 'fetch_url' }))?.includes('needs a "url"'), true);
eq(
  'a private target is refused with an actionable message',
  (await throws({ tool: 'fetch_url', url: 'http://127.0.0.1/' }))?.startsWith('Cannot fetch'),
  true,
);

console.log('\n5. HTML -> text, against fixtures');
{
  const { htmlToText } = jiti(`${ROOT}/src/lib/tools/executors/fetch-url.ts`);
  const doc = [
    '<html><head><title>  Spaced  Title </title>',
    '<style>body{color:red}</style></head><body>',
    '<nav>Home About Contact</nav>',
    '<h1>Real Heading</h1>',
    '<p>First para &amp; an entity.</p>',
    '<script>alert("xss")</script>',
    '<ul><li>one</li><li>two</li></ul>',
    '<p>Line<br>break</p>',
    '<footer>Copyright</footer>',
    '</body></html>',
  ].join('\n');
  const { title, text } = htmlToText(doc);
  eq('title is extracted and trimmed', title, 'Spaced  Title');
  eq('heading text survives', text.includes('Real Heading'), true);
  eq('entities are decoded', text.includes('First para & an entity.'), true);
  eq('list items get a bullet', text.includes('- one'), true);
  eq('<br> becomes a newline', text.includes('Line\nbreak'), true);
  eq('script contents are dropped', text.includes('alert'), false);
  eq('style contents are dropped', text.includes('color:red'), false);
  eq('nav chrome is dropped', text.includes('About'), false);
  eq('footer chrome is dropped', text.includes('Copyright'), false);
  eq('no markup survives', /<\/?[a-z]+[^>]*>/i.test(text), false);
  eq('numeric entities decode', htmlToText('<p>&#39;q&#x27;</p>').text, "'q'");
}

console.log('\n6. live fetch (smoke test — needs network)');
try {
  const { text } = await fetchUrl({ tool: 'fetch_url', url: 'https://example.com/' });
  // Deliberately structural: the remote copy is not ours to depend on.
  eq('reports the final URL', text.includes('Fetched: https://example.com/'), true);
  eq('extracts the title', text.includes('Title: Example Domain'), true);
  eq('returns a non-trivial body', text.split('\n\n')[1]?.length > 40, true);
  eq('no markup survives', /<\/?[a-z]+[^>]*>/i.test(text), false);
  eq(
    'respects maxChars',
    (
      await fetchUrl({ tool: 'fetch_url', url: 'https://example.com/', maxChars: 50 })
    ).text.includes('truncated at 50'),
    true,
  );
} catch (err) {
  console.log(`  SKIP live fetch — ${err.message}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
