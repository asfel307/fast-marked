[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/asfel307/fast-marked/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/asfel307/fast-marked/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

# fast-marked

A quicker drop-in for [marked](https://github.com/markedjs/marked) 18.1.3.
It produces exactly the HTML `marked.parse` produces with marked's
defaults (GitHub Flavoured Markdown on, hard breaks off) — the same bytes,
just with less CPU spent getting there.

Built for make.fun's
[markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02)
bounty.

## How it works

marked's own tokenizer methods still build every token, which is what
keeps the output identical. Only the two loops that call those methods
are rewritten, so that each one dispatches on the first character:

- **Block level:** a line opening with `#` is tried as a heading, a table,
  a setext heading or a paragraph — never as a list, a blockquote, an HTML
  block or anything else. Table, setext heading, paragraph and plain text
  stay on the candidate list for every line, since any of them can start
  with any character.
- **Inline level:** a backslash is only ever an escape or a hard break, a
  backtick only ever opens a code span, `[` only ever opens a link, and so
  on. Plain words still go through marked's own inline text rule, so a run
  of prose costs one match instead of one try per rule.
- **Emphasis masking:** before the inline scan runs, link destinations,
  code spans and inline HTML are blanked to placeholders of the same
  length, the way marked does it, so a `*` inside them never counts as an
  emphasis delimiter. Reference links that resolve get blanked the same
  way.

`parse()` constructs a fresh lexer and parser for every call, so nothing
leaks between renders and one input's result never depends on an earlier
one. Nothing is cached across calls and no output is looked up by input.

## Layout

- `parse.js` — the entry point: exports `parse(markdown)`.
- `main.ts` — the harness driver: reads `/input/cases.json`, renders every
  case with `parse()`, writes `/output/html.json`.
- `vendor/marked/` — marked 18.1.3, byte for byte from npm, under its MIT
  licence (see `vendor/marked/LICENSE` and `vendor/marked/NOTICE`).

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

## Licence

MIT. marked itself is MIT-licensed; its licence and notice are kept in
`vendor/marked/`.

---

Entered on [make.fun](https://make.fun/r/tvfbjxfd) — build the fastest
drop-in for marked.
