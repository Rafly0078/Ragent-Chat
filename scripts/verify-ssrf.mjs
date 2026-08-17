/**
 * Exercises the SSRF guard's address rules, IPv6 in particular.
 *
 * The regression this pins down: `new URL()` re-serializes an IPv6 host before
 * anything else sees it, so `[::ffff:127.0.0.1]` arrives as `::ffff:7f00:1` and
 * a rule written against the dotted-quad spelling never fires.
 *
 * Run: node scripts/verify-ssrf.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]$/, '');
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: { '@': `${ROOT}/src`, 'server-only': `${ROOT}/scripts/_empty-module.cjs` },
  interopDefault: true,
  esmResolve: true,
});

const { blockedAddress } = jiti(`${ROOT}/src/lib/server/public-url.ts`);

/** Every one of these must be refused. */
const BLOCKED = [
  // IPv4 literals.
  '127.0.0.1',
  '10.0.0.1',
  '192.168.1.1',
  '172.20.0.1',
  '169.254.169.254',
  '0.0.0.0',
  '100.100.0.1',
  '224.0.0.1',
  '198.18.0.1',
  // IPv6 loopback / unspecified, both spellings of ::/96.
  '::1',
  '::',
  '::2',
  '::127.0.0.1',
  // IPv4-mapped, in every spelling `new URL` can hand us.
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '0:0:0:0:0:ffff:7f00:0001',
  '::ffff:169.254.169.254',
  '::ffff:a9fe:a9fe',
  '0:0:0:0:0:ffff:a9fe:a9fe',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  '::ffff:192.168.1.1',
  '::ffff:c0a8:101',
  '::ffff:172.16.0.1',
  '::ffff:0.0.0.0',
  '::ffff:100.64.0.1',
  // Reserved ranges.
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'fe80::1%eth0',
  'ff02::1',
  '2001:db8::1',
  '2001:0:5ef5:79fd::1',
  '2002:7f00:1::',
  '64:ff9b::7f00:1',
  // Not an address at all.
  'garbage',
  '',
  '1.2.3',
  '::gggg:1',
  '1:2:3:4:5:6:7:8:9',
];

/** Every one of these must be allowed — over-blocking breaks real fetches. */
const ALLOWED = [
  '1.1.1.1',
  '8.8.8.8',
  '93.184.216.34',
  '13.107.42.14',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '2400:cb00::1',
  '2a00:1450:4001::200e',
  '2001:db9::1',
  '2003::1',
  '::ffff:8.8.8.8',
  '::ffff:808:808',
];

let fail = 0;
for (const address of BLOCKED) {
  if (!blockedAddress(address)) {
    console.error(`FAIL  should be blocked: ${JSON.stringify(address)}`);
    fail++;
  }
}
for (const address of ALLOWED) {
  if (blockedAddress(address)) {
    console.error(`FAIL  should be allowed: ${JSON.stringify(address)}`);
    fail++;
  }
}

const total = BLOCKED.length + ALLOWED.length;
if (fail) {
  console.error(`\n${fail}/${total} cases failed.`);
  process.exit(1);
}
console.log(`ok — ${total} address cases (${BLOCKED.length} blocked, ${ALLOWED.length} allowed)`);
