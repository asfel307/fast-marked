# fast-marked

A faster drop-in for [marked](https://github.com/markedjs/marked) 18.1.3:
`parse(markdown)` returns exactly the HTML marked renders with its default
options (gfm true, breaks false), byte for byte, for every input — but
faster. Built for make.fun's
[markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02)
bounty ($250).

## How it is faster

It is a fork of marked itself (MIT, see `vendor/marked/`, credited below),
with the hot tokenizing loops rewritten to dispatch on the first character
instead of trying every tokenizer in turn:

- **Inline loop**: a run with no `*`, `_` or `~` takes a dispatched fast
  loop (escape/tag/link/reflink/codespan/br/autolink/url/text chosen by
  the first character, so a plain-text run costs one regex instead of
  ten). Runs that do hold emphasis or strikethrough delimiters go through
  marked's own inline pass unchanged (masked source, closer scan, all).
- **List loop**: the same first-character dispatch inside the list
  tokenizer's line loop (fences, headings, HTML, blockquotes, bullets,
  and rules are only tested when the line's first non-space character can
  start one), plus cheaper line handling (`slice` instead of `split`,
  tab-expansion only when a tab is present). The list algorithm, its
  output, and its error paths are unchanged.
- Every tokenizer called is marked's own, in marked's own order, so the
  tokens — and therefore the HTML — are identical.

`parse()` is stateless per call: no cache, no memo, nothing kept between
calls, no clock, no file or environment reads. Each case renders alone.

## Files

- `parse.js` — the entrypoint: `parse(markdown)` plus the `FastLexer`
  subclass carrying the dispatched loops, and `FastTokenizer` carrying
  the dispatched list loop.
- `main.ts` — the harness driver: reads `/input/cases.json`, renders each
  case alone, writes `/output/html.json`.
- `vendor/marked/` — marked 18.1.3, byte for byte as shipped in the
  competition kit (its own LICENSE and NOTICE apply to those files).

## Credit

This entry forks [marked](https://github.com/markedjs/marked) 18.1.3
(MIT License, Copyright (c) 2011-2024, Christopher Jeffrey and contributors;
see `vendor/marked/LICENSE` and `vendor/marked/NOTICE`). The speed work is
in `parse.js`; the vendored marked source is unchanged.

## Verification

Scored against the kit's practice set (720 cases) with the kit scorer:
720/720 identical to marked's HTML. Timed in-process on the same set with
interleaved paired runs, median ratio: marked ~770 ms, fast-marked ~680 ms
per set (**1.14x**).
