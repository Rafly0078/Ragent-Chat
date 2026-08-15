/**
 * Exercises the two text-directive parsers after they were moved onto the shared
 * nested-fence scanner: artifact detection and codepatch detection.
 *
 * Run: node scripts/verify-tools.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolved from this file, so the script works from any cwd.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: { '@': `${ROOT}/src` },
  interopDefault: true,
  esmResolve: true,
});

const { detectArtifacts, hasCompleteDirective } = jiti(`${ROOT}/src/lib/tools/detect.ts`);
const { detectPatches } = jiti(`${ROOT}/src/lib/tools/patch.ts`);
const { findFences } = jiti(`${ROOT}/src/lib/tools/fences.ts`);
const { validateGenerateRequest } = jiti(`${ROOT}/src/lib/tools/validate.ts`);
const { toolDefinitions } = jiti(`${ROOT}/src/lib/tools/schemas.ts`);

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
const F = '```';
const F4 = '````';

console.log('\n1. nested fences no longer truncate the body');
{
  // A markdown doc that itself documents code — the routine case that a lazy
  // regex broke by stopping at the first inner closing fence.
  const doc = [
    `${F}artifact`,
    'tool: create_md',
    'name: guide.md',
    '---',
    '# Guide',
    '',
    `${F}js`,
    'const a = 1;',
    F,
    '',
    'Tail paragraph.',
    F,
  ].join('\n');
  const r = detectArtifacts(doc);
  eq('one request found', r.requests.length, 1);
  eq('inner fence survives', r.requests[0].content.includes('const a = 1;'), true);
  eq(
    'text after the inner fence survives',
    r.requests[0].content.includes('Tail paragraph.'),
    true,
  );
  eq('block is stripped from the message', r.cleaned.includes('create_md'), false);
}

console.log('\n2. the detection gate is no longer needlessly strict');
eq(
  'capitalised tag is accepted',
  detectArtifacts([`${F}Artifact`, 'tool: create_txt', '---', 'hi', F].join('\n')).requests.length,
  1,
);
eq(
  'trailing info string after the keyword is accepted',
  detectArtifacts([`${F}artifact json`, 'tool: create_txt', '---', 'hi', F].join('\n')).requests
    .length,
  1,
);
eq(
  'a header key with a digit does not abort header parsing',
  detectArtifacts(
    [`${F}artifact`, 'tool: create_txt', 'name: a1.txt', 'x2: y', '---', 'hi', F].join('\n'),
  ).requests.length,
  1,
);
eq(
  'a longer outer fence still works',
  detectArtifacts([`${F4}artifact`, 'tool: create_txt', '---', 'hi', F4].join('\n')).requests
    .length,
  1,
);

console.log('\n3. recoverable malformations');
{
  // Missing `---`: the single most common small-model mistake, previously total loss.
  const r = detectArtifacts(
    [`${F}artifact`, 'tool: create_md', 'name: n.md', '# Real heading', 'body', F].join('\n'),
  );
  eq('missing separator still parses', r.requests.length, 1);
  eq('the first non-header line becomes the body', r.requests[0].content, '# Real heading\nbody');
}
{
  // Unterminated outer fence — an inner fence was opened and never closed.
  const r = detectArtifacts(
    [`${F}artifact`, 'tool: create_md', '---', '# Doc', `${F}js`, 'x'].join('\n'),
  );
  eq('unterminated block is recovered, not discarded', r.requests.length, 1);
  eq('body keeps what was emitted', r.requests[0].content.includes('# Doc'), true);
}

console.log('\n4. things that must NOT be treated as directives');
eq('prose mentioning the word', detectArtifacts('I will build an artifact for you.').found, false);
eq(
  'an unknown tool name is rejected',
  detectArtifacts([`${F}artifact`, 'tool: create_hologram', '---', 'x', F].join('\n')).requests
    .length,
  0,
);
eq(
  'a future-flagged tool is rejected rather than stripped',
  detectArtifacts([`${F}artifact`, 'tool: export_chat', '---', 'x', F].join('\n')).requests.length,
  0,
);
eq(
  'a rejected block stays visible in the message',
  detectArtifacts([`${F}artifact`, 'tool: nope', '---', 'x', F].join('\n')).cleaned.includes(
    'nope',
  ),
  true,
);
eq(
  'no tool header, no directive',
  detectArtifacts([`${F}artifact`, 'just text', F].join('\n')).requests.length,
  0,
);

console.log('\n5. hasCompleteDirective (drives the abort-path recovery)');
eq(
  'complete block',
  hasCompleteDirective([`${F}artifact`, 'tool: create_txt', '---', 'x', F].join('\n')),
  true,
);
eq('no fence at all', hasCompleteDirective('nothing here'), false);

console.log('\n6. codepatch, now on the same scanner');
{
  const hunk = ['<<<<<<< SEARCH', 'const a = 1;', '=======', 'const a = 2;', '>>>>>>> REPLACE'];
  const r = detectPatches([`${F}codepatch`, 'lang: js', ...hunk, F].join('\n'));
  eq('one directive', r.patches.length, 1);
  eq('lang captured', r.patches[0].lang, 'js');
  eq('hunk captured', r.patches[0].hunks[0].replace, 'const a = 2;');
  eq('block stripped', r.cleaned.includes('SEARCH'), false);
}
{
  // The bug: a REPLACE body containing a markdown fence truncated the hunk.
  const r = detectPatches(
    [
      `${F4}codepatch`,
      '<<<<<<< SEARCH',
      'old',
      '=======',
      'new line one',
      `${F}js`,
      'nested();',
      F,
      'new line two',
      '>>>>>>> REPLACE',
      F4,
    ].join('\n'),
  );
  eq('directive survives a nested fence', r.patches.length, 1);
  eq(
    'the whole replacement survives',
    r.patches[0].hunks[0].replace.includes('new line two'),
    true,
  );
}
eq(
  'a malformed patch stays visible',
  detectPatches([`${F}codepatch`, 'no hunks here', F].join('\n')).cleaned.includes('no hunks'),
  true,
);
eq(
  'capitalised codepatch tag is accepted',
  detectPatches(
    [`${F}CodePatch`, '<<<<<<< SEARCH', 'a', '=======', 'b', '>>>>>>> REPLACE', F].join('\n'),
  ).patches.length,
  1,
);

console.log('\n7. the shared scanner itself');
eq(
  'two sibling blocks are found independently',
  findFences([`${F}x`, 'a', F, 'mid', `${F}x`, 'b', F].join('\n'), 'x').matches.map((m) => m.body),
  ['a', 'b'],
);
eq(
  'unterminated is flagged',
  findFences([`${F}x`, 'a'].join('\n'), 'x').matches[0].unterminated,
  true,
);

console.log('\n8. HTTP-boundary validation (/api/tools/execute)');
{
  const v = (body) => validateGenerateRequest(body);
  eq('a non-object body is rejected', v('nope').ok, false);
  eq('a missing tool is rejected', v({}).error, 'Missing "tool" field.');
  eq('an unknown tool is rejected', v({ tool: 'create_hologram' }).ok, false);
  eq('a future tool is rejected', v({ tool: 'export_chat' }).ok, false);

  // The reachable type-confusion 500: a string `rows` has `.length`, so it passed
  // the executor's truthiness check and then threw inside `.map`.
  eq(
    'a string where rows belong is rejected, not 500',
    v({ tool: 'create_csv', rows: 'oops' }).ok,
    false,
  );
  eq(
    'a non-string content is coerced rather than reaching the executor',
    v({ tool: 'create_txt', content: 12345 }).request.content,
    '12345',
  );
  eq(
    'a scalar row is repaired into a single-cell row',
    v({ tool: 'create_csv', rows: ['a', 'b'] }).request.rows,
    [['a'], ['b']],
  );
  eq(
    'cell values are stringified',
    v({ tool: 'create_csv', rows: [[1, true, null]] }).request.rows,
    [['1', 'true', '']],
  );
  eq(
    'an unnamed sheet gets a default name rather than being dropped',
    v({ tool: 'create_xlsx', sheets: [{ rows: [['a']] }] }).request.sheets[0].name,
    'Sheet1',
  );
  eq(
    'a file entry without a path is dropped',
    v({
      tool: 'zip_project',
      files: [
        { path: '', content: 'x' },
        { path: 'a.txt', content: 'y' },
      ],
    }).request.files,
    [{ path: 'a.txt', content: 'y' }],
  );
  eq(
    'zip_project with no usable files is rejected with an actionable message',
    v({ tool: 'zip_project', files: [] }).error.includes('zip_project needs'),
    true,
  );
  eq('a document tool with no payload is rejected', v({ tool: 'create_pdf' }).ok, false);
  eq('create_json accepts `data` alone', v({ tool: 'create_json', data: { a: 1 } }).ok, true);
  eq(
    'a non-object theme is discarded rather than passed through',
    v({ tool: 'create_pdf', content: 'x', theme: 'blue' }).request.theme,
    undefined,
  );
}

console.log('\n9. tool schemas offered for native function calling');
{
  const defs = toolDefinitions();
  eq(
    'every offered tool has a schema and an object type',
    defs.every((d) => d.schema.type === 'object'),
    true,
  );
  eq(
    'the future-flagged tool is never offered',
    defs.some((d) => d.name === 'export_chat'),
    false,
  );
  eq(
    'every schema name is a real tool the validator accepts',
    defs.every(
      (d) =>
        validateGenerateRequest({
          tool: d.name,
          // A kitchen-sink payload: whatever each tool's minimum is, it's in here.
          content: 'x',
          files: [{ path: 'a', content: 'b' }],
          rows: [['a']],
          data: {},
          url: 'https://example.com/',
        }).ok,
    ),
    true,
  );
  eq(
    'zip_project requires files',
    toolDefinitions().find((d) => d.name === 'zip_project').schema.required,
    ['files'],
  );
  eq(
    'fetch_url is offered and requires a url',
    toolDefinitions().find((d) => d.name === 'fetch_url')?.schema.required,
    ['url'],
  );
  eq(
    'a read tool is NOT reachable through the text directive',
    detectArtifacts([`${F}artifact`, 'tool: fetch_url', '---', 'https://x.com', F].join('\n'))
      .requests.length,
    0,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
