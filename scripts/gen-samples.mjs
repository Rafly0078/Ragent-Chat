/**
 * Generate one sample of each themed format into ./tmp-samples for eyeballing.
 *
 * Not part of the build. Run with:  node scripts/gen-samples.mjs
 *
 * The executors are TypeScript with `@/` path aliases and an `import
 * 'server-only'` marker that only Next.js resolves, so this registers two
 * resolve hooks — alias rewriting and a stub for `server-only` — and lets
 * Node's built-in type stripping handle the rest.
 */
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SERVER_ONLY = 'data:text/javascript,';

/** TS source omits extensions; Node's resolver does not guess them. */
function withExt(base) {
  const isFile = (p) => existsSync(p) && statSync(p).isFile();
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (isFile(c)) return c;
  }
  return base;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: SERVER_ONLY, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const abs = withExt(path.join(root, 'src', specifier.slice(2)));
      return nextResolve(pathToFileURL(abs).href, context);
    }
    // Relative imports between TS sources are extensionless too.
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const abs = withExt(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      return nextResolve(pathToFileURL(abs).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const MD = `# Quarterly Platform Review

Revenue reached ==$4.2M in Q3==, up 18% year over year. The gain came almost
entirely from the enterprise tier, where seat expansion outpaced new logos for
the first time since launch.

## Highlights

- Enterprise ARR crossed **$3.1M**, now 74% of total
- Median time-to-first-value fell from 11 days to *4 days*
- Churn held flat at 1.2% monthly despite the price change

:::success What worked
Self-serve onboarding removed the sales call from the first week. Every cohort
since June has activated faster than the one before it.
:::

:::warning Watch this
Support load per account is rising faster than headcount. At the current slope
the queue exceeds capacity in ~7 weeks.
:::

## Numbers

| Segment | Q2 | Q3 | Change |
| --- | ---: | ---: | ---: |
| Enterprise | 2.4M | 3.1M | +29% |
| Team | 0.9M | 0.8M | -11% |
| Individual | 0.3M | 0.3M | 0% |

> The enterprise motion is working. The self-serve funnel is not paying for
> itself yet.

## Implementation note

The activation metric is computed nightly:

\`\`\`sql
SELECT account_id, min(event_at) AS first_value
FROM   product_events
WHERE  event_name = 'workspace_published'
GROUP  BY account_id;
\`\`\`

<!-- pagebreak -->

## Next quarter

1. Hire two support engineers before the queue breaks
2. Re-price the Team tier or sunset it
3. Ship SSO, the top blocker in 9 of 14 lost deals

:::danger Risk
The Team tier decline is not yet explained. If it is cannibalisation by
Enterprise it is fine; if it is a product problem it will reach Enterprise next.
:::

See the [full dashboard](https://example.com/dashboard) for daily figures.
`;

const req = {
  tool: 'create_pdf',
  name: 'sample',
  title: 'Quarterly Platform Review',
  content: MD,
  theme: {
    accent: '#0F766E',
    font: 'editorial',
    subtitle: 'Q3 2025 · Prepared for the board',
    author: 'Acme Analytics',
    cover: true,
  },
};

const ctx = { userId: 'local-sample' };
const outDir = path.join(root, 'tmp-samples');
await mkdir(outDir, { recursive: true });

for (const [tool, mod] of [
  ['create_pdf', './src/lib/tools/executors/pdf.ts'],
  ['create_docx', './src/lib/tools/executors/docx.ts'],
  ['create_pptx', './src/lib/tools/executors/pptx.ts'],
  ['create_txt', './src/lib/tools/executors/txt.ts'],
]) {
  const started = Date.now();
  try {
    const run = (await import(pathToFileURL(path.join(root, mod)).href)).default;
    const out = await run({ ...req, tool }, ctx);
    const file = path.join(outDir, `sample.${out.ext}`);
    await writeFile(file, out.buffer);
    console.log(
      `${tool.padEnd(12)} ok  ${String(out.buffer.length).padStart(8)} bytes  ${Date.now() - started}ms  ${file}`,
    );
  } catch (err) {
    console.error(`${tool.padEnd(12)} FAIL ${err?.stack ?? err}`);
  }
}
