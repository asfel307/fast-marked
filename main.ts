// Driver for the fast-marked entry: reads every case from the input
// directory, renders each one alone with parse() from parse.js, and writes
// the HTML strings, in the cases' order, to the output directory as
// html.json. The harness runs `node /bot/main.ts`; outside a container the
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR variables stand in for /input
// and /output. No case is cached or shared with another: each render is
// a fresh parse() call on that case's markdown alone.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));

const rendered = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  rendered[i] = parse(cases[i].markdown);
}

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(rendered));
