// Driver for the fast-marked entry.
//
// The harness runs this file as `node /bot/main.ts`. It reads the case set
// (a JSON array of { id, markdown }) from the input directory, renders each
// case on its own with parse(), and writes the HTML strings, in the cases'
// order, as a JSON array to the output directory.
//
// Outside the grading container the same two directories can be pointed at
// local folders with MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases: { id: string; markdown: string }[] = JSON.parse(
  readFileSync(join(inputDir, 'cases.json'), 'utf8')
);

const rendered: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  rendered[i] = parse(cases[i].markdown);
}

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(rendered));
