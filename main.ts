// Driver for the marked-faster entry.
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

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(inDir, 'cases.json'), 'utf8');
const items = JSON.parse(raw) as { id: string; markdown: string }[];

const html: string[] = new Array(items.length);
for (let i = 0; i < items.length; i++) html[i] = parse(items[i].markdown);

writeFileSync(join(outDir, 'html.json'), JSON.stringify(html));
