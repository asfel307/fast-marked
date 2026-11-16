[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/asfel307/fast-marked/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/asfel307/fast-marked/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

# fast-marked

A faster drop-in for [marked](https://github.com/markedjs/marked) 18.1.3: it
renders exactly the same HTML as `marked.parse` with marked's default
options (GitHub Flavoured Markdown on, hard breaks off), only quicker.

Built for make.fun's
[markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02)
bounty.

## How it works

The entry is a fork of marked. marked's own tokenizer methods still build
every token, which is what keeps the output byte-identical, but the two
loops that drive them are rewritten to dispatch on the first character:

- **Block level:** a line starting with `#` can only be a heading, a table,
  a setext heading or a paragraph, so the list, blockquote, HTML and other
  rules are never tried on it. A table, a setext heading, a paragraph and
  plain text stay candidates for every line, because any of them can begin
  with any character.
- **Inline level:** a backslash can only be an escape, a backtick can only
  open a code span, `[` can only start a link, and so on. Ordinary text is
  still consumed by marked's own inline text rule, so a run of plain words
  costs a single match instead of one try per rule.
- **Emphasis masking:** before the inline loop runs, link destinations,
  code spans and inline HTML are blanked to same-length placeholders, the
  way marked does it, so a `*` inside them never counts as an emphasis
  delimiter. Reference links that resolve are blanked the same way.

`parse()` builds a fresh lexer and parser per call, so no state leaks
between renders and the result for one input never depends on an earlier
one. There is no caching across calls and no lookup keyed on an input.

## Layout

- `parse.js` — the entry point: exports `parse(markdown)`.
- `main.ts` — the harness driver: reads `/input/cases.json`, renders each
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
