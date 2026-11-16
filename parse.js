// marked-faster — a quicker drop-in for marked 18.1.3.
//
// marked's own Tokenizer still does the real work: it builds every token,
// which is why the HTML comes out byte for byte the same. What this file
// changes is only how the tokenizer methods get called. marked tries its
// block rules one after another on every line and its inline rules one
// after another on every character, running a pile of regular expressions
// that cannot possibly match. Here the first character decides which rules
// are even attempted:
//
//   * At block level a line that opens with `#` is tried as a heading, a
//     table, a setext heading or a paragraph, and never as a list, a
//     blockquote or an HTML block. Table, setext heading, paragraph and
//     plain text are tried for every line, because any of them can start
//     with any character at all.
//   * At inline level a backslash is only ever an escape or a hard break,
//     a backtick only ever opens a code span, `[` only ever starts a link,
//     and so on. Runs of ordinary words go straight to marked's own text
//     rule, so a paragraph of prose costs one match per run.
//
// The emphasis pass needs a masked copy of the inline source, the way
// marked makes one, so that a `*` sitting inside a link destination, a
// code span or inline HTML is never treated as a delimiter. That masking
// is reproduced below with the same patterns marked uses. marked's own
// closer cache is internal and cannot be reused, so an emphasis run
// re-scans the masked text once per delimiter run; inline runs are short,
// so that stays cheap.

import { Lexer, Parser, Tokenizer, getDefaults } from './vendor/marked/marked.esm.js';

// Fold a link-reference label the way marked does: trim the ends, squash
// every run of whitespace down to one space, then fold the case through
// lower, upper and lower again so the fold is Unicode-aware.
function foldLabel(text) {
  const squashed = text.trim().replace(/\s+/g, ' ');
  return squashed.toLowerCase().toUpperCase().toLowerCase();
}

// The characters that may open a URL or an e-mail address, as a table over
// the ASCII range. A URL rule matches a scheme (http, https, ftp, www,
// mailto) or an address whose local part is built from these characters,
// so any other character can skip the URL attempt outright.
const urlOk = new Uint8Array(128);
for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&\'*+-./=?^_`{|}~') {
  urlOk[ch.charCodeAt(0)] = 1;
}
function urlStarter(code) {
  return code < 128 && urlOk[code] === 1;
}

class DispatchLexer extends Lexer {
  // Same entry point as marked's lexer, except the carriage-return pass is
  // skipped outright when the input has no carriage return in it: the
  // replacement would change nothing there, but the pattern would still
  // walk the whole text to find out.
  lex(src) {
    if (src.includes('\r')) src = src.replace(this.tokenizer.rules.other.carriageReturn, '\n');
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) {
      const item = this.inlineQueue[i];
      this.state.inRawBlock = false;
      this.inlineTokens(item.src, item.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }

  // Block tokenisation driven by the first character. Rules are still
  // attempted in marked's own order; the dispatch only leaves out the
  // ones whose pattern cannot open with the character at hand. Paragraph
  // and plain text are candidates on every line, and so are table and
  // setext heading, because either of them can begin with anything.
  blockTokens(src, tokens = [], continued = false) {
    this.tokenizer.lexer = this;
    const other = this.tokenizer.rules.other;
    if (this.options.pedantic) {
      src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
    }
    // Consume a matched token: drop its raw text from the front of the
    // source and record the token.
    const take = (tok) => {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
    };
    let shortest = Infinity;
    while (src) {
      if (src.length < shortest) {
        shortest = src.length;
      } else {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
      let token;
      if (this.options.extensions?.block?.some((ext) => {
        token = ext.call({ lexer: this }, src, tokens);
        if (token) {
          take(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      const first = src.charCodeAt(0);
      const ws = first === 32 || first === 9;
      if ((first === 10 || ws) && (token = this.tokenizer.space(src))) {
        src = src.slice(token.raw.length);
        const prev = tokens.at(-1);
        if (token.raw.length === 1 && prev !== undefined) {
          prev.raw += '\n';
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (ws && (token = this.tokenizer.code(src))) {
        src = src.slice(token.raw.length);
        const prev = tokens.at(-1);
        if (prev?.type === 'paragraph' || prev?.type === 'text') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
          prev.text += '\n' + token.text;
          this.inlineQueue.at(-1).src = prev.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if ((ws || first === 96 || first === 126) && (token = this.tokenizer.fences(src))) {
        take(token);
        continue;
      }
      if ((ws || first === 35) && (token = this.tokenizer.heading(src))) {
        take(token);
        continue;
      }
      if ((ws || first === 45 || first === 95 || first === 42) && (token = this.tokenizer.hr(src))) {
        take(token);
        continue;
      }
      if ((ws || first === 62) && (token = this.tokenizer.blockquote(src))) {
        take(token);
        continue;
      }
      if ((ws || first === 42 || first === 43 || first === 45 || (first >= 48 && first <= 57)) && (token = this.tokenizer.list(src))) {
        take(token);
        continue;
      }
      if ((ws || first === 60) && (token = this.tokenizer.html(src))) {
        take(token);
        continue;
      }
      if ((ws || first === 91) && (token = this.tokenizer.def(src))) {
        src = src.slice(token.raw.length);
        const prev = tokens.at(-1);
        if (prev?.type === 'paragraph' || prev?.type === 'text') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
          prev.text += '\n' + token.raw;
          this.inlineQueue.at(-1).src = prev.text;
        } else {
          if (!this.tokens.links[token.tag]) {
            this.tokens.links[token.tag] = { href: token.href, title: token.title };
          }
          tokens.push(token);
        }
        continue;
      }
      if ((token = this.tokenizer.table(src))) {
        take(token);
        continue;
      }
      if ((token = this.tokenizer.lheading(src))) {
        take(token);
        continue;
      }
      let cut = src;
      if (this.options.extensions?.startBlock) {
        let nearest = Infinity;
        const rest = src.slice(1);
        for (const start of this.options.extensions.startBlock) {
          const at = start.call({ lexer: this }, rest);
          if (typeof at === 'number' && at >= 0) nearest = Math.min(nearest, at);
        }
        if (nearest < Infinity && nearest >= 0) cut = src.substring(0, nearest + 1);
      }
      if (this.state.top && (token = this.tokenizer.paragraph(cut))) {
        const prev = tokens.at(-1);
        if (continued && prev?.type === 'paragraph') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
          prev.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = prev.text;
        } else {
          tokens.push(token);
        }
        continued = cut.length !== src.length;
        src = src.slice(token.raw.length);
        continue;
      }
      if ((token = this.tokenizer.text(src))) {
        src = src.slice(token.raw.length);
        const prev = tokens.at(-1);
        if (prev?.type === 'text') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
          prev.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = prev.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (src) {
        this.infiniteLoopError(src.charCodeAt(0));
        break;
      }
    }
    this.state.top = true;
    return tokens;
  }

  // Inline tokenisation entry point: the same link-paren bookkeeping as
  // marked, then the dispatched scan below.
  inlineTokens(src, tokens = []) {
    this.tokenizer.lexer = this;
    const saved = this.state.linkParenPossible;
    this.state.linkParenPossible = saved && src.includes(')');
    try {
      return this.scanInline(src, tokens);
    } finally {
      this.state.linkParenPossible = saved;
    }
  }

  // Try to read a URL or e-mail token at the front of `rest`. Returns the
  // remaining text after the token, or null when no URL matched or when
  // the lexer is already inside a link.
  attemptUrl(rest, tokens) {
    if (this.state.inLink) return null;
    const hit = this.tokenizer.url(rest);
    if (!hit) return null;
    tokens.push(hit);
    return rest.slice(hit.raw.length);
  }

  // The masked copy that emStrong and del scan for their closers. Link
  // and image destinations, code spans and inline HTML are blanked out
  // to placeholders of the same length, so a `*` inside any of them never
  // counts as a delimiter, and reference links that resolve are blanked
  // the same way.
  blankInline(src) {
    const rules = this.tokenizer.rules.inline;
    let out = src;
    if (this.tokens.links && src.includes('[')) {
      const find = rules.reflinkSearch;
      const blankRef = (hit) => {
        const open = hit.lastIndexOf('[');
        if (!Object.hasOwn(this.tokens.links, foldLabel(hit.slice(open + 1, -1)))) {
          return hit;
        }
        if (open > 1 && hit.charAt(0) !== '!') {
          const inner = hit.slice(1, open - 1);
          if (this.linkInText(inner)) {
            return '[' + inner.replace(find, blankRef) + '][' + 'a'.repeat(hit.length - open - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(hit.length - 2) + ']';
      };
      out = out.replace(find, blankRef);
    }
    out = out.replace(
      rules.anyPunctuationOutsideCode,
      (hit, ticks, escaped) => escaped
        ? '+'.repeat(hit.length)
        : ticks
          ? ticks + hit.slice(ticks.length, -ticks.length).replace(/`/g, '+') + ticks
          : hit
    );
    out = out.replace(
      rules.blockSkip,
      (hit, _ticks, empty) => {
        const lead = empty ? empty.length : 0;
        return hit.slice(0, lead) + '[' + 'a'.repeat(hit.length - lead - 2) + ']';
      }
    );
    const hook = this.options.hooks?.emStrongMask;
    if (hook) out = hook.call({ lexer: this }, out) ?? out;
    return out;
  }

  // Inline tokenisation driven by the first character. At each position
  // only the inline rules that can open with that character are tried,
  // in marked's own order; a URL or e-mail is tried whenever the character
  // could open one, and plain text falls through to marked's inlineText.
  // `lastChar` is the last character of the preceding text token (or the
  // empty string when the preceding token was not text), exactly as marked
  // tracks it for its emphasis and strikethrough closers.
  scanInline(src, tokens) {
    const tok = this.tokenizer;
    const needMask = src.includes('*') || src.includes('_') || src.includes('~');
    const custom = this.options.hooks?.emStrongMask
      || tok.emStrong !== Tokenizer.prototype.emStrong
      || tok.del !== Tokenizer.prototype.del;
    const masked = (needMask || custom) ? this.blankInline(src) : src;
    let lastChar = '';
    let wasText = false;
    let shortest = Infinity;
    let rest = src;
    while (rest) {
      if (rest.length < shortest) {
        shortest = rest.length;
      } else {
        this.infiniteLoopError(rest.charCodeAt(0));
        break;
      }
      if (!wasText) lastChar = '';
      wasText = false;
      let token;
      if (this.options.extensions?.inline?.some((ext) => {
        token = ext.call({ lexer: this }, rest, tokens);
        if (token) {
          rest = rest.slice(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      const first = rest.charCodeAt(0);
      switch (first) {
        case 92: { // backslash: an escape, then a hard break
          token = tok.escape(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          token = tok.br(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          break;
        }
        case 60: { // <: a tag, then an autolink
          token = tok.tag(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          token = tok.autolink(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          break;
        }
        case 91: case 33: { // [ or !: a link, then a reference link
          token = tok.link(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          token = tok.reflink(rest, this.tokens.links);
          if (token) {
            rest = rest.slice(token.raw.length);
            const prev = tokens.at(-1);
            if (token.type === 'text' && prev?.type === 'text') {
              prev.raw += token.raw;
              prev.text += token.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
          break;
        }
        case 42: case 95: { // * or _: emphasis, then a URL
          token = tok.emStrong(rest, masked, lastChar);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          const after = this.attemptUrl(rest, tokens);
          if (after !== null) {
            rest = after;
            continue;
          }
          break;
        }
        case 96: { // backtick: a code span, then a URL
          token = tok.codespan(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          const after = this.attemptUrl(rest, tokens);
          if (after !== null) {
            rest = after;
            continue;
          }
          break;
        }
        case 32: { // space: a hard break
          token = tok.br(rest);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          break;
        }
        case 126: { // ~: strikethrough, then a URL
          token = tok.del(rest, masked, lastChar);
          if (token) {
            rest = rest.slice(token.raw.length);
            tokens.push(token);
            continue;
          }
          const after = this.attemptUrl(rest, tokens);
          if (after !== null) {
            rest = after;
            continue;
          }
          break;
        }
        default: { // letter, digit or e-mail punctuation: a URL
          if (urlStarter(first)) {
            const after = this.attemptUrl(rest, tokens);
            if (after !== null) {
              rest = after;
              continue;
            }
          }
          break;
        }
      }
      token = tok.inlineText(rest);
      if (token) {
        rest = rest.slice(token.raw.length);
        if (token.raw.slice(-1) !== '_') lastChar = token.raw.slice(-1);
        wasText = true;
        const prev = tokens.at(-1);
        if (prev?.type === 'text') {
          prev.raw += token.raw;
          prev.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (rest) {
        this.infiniteLoopError(rest.charCodeAt(0));
        break;
      }
    }
    return tokens;
  }
}

// Render one Markdown string to the HTML marked 18.1.3 renders for it,
// with marked's defaults (GitHub Flavoured Markdown on, hard breaks off).
// A fresh lexer and parser are built per call, so no state leaks between
// renders and the result for one input never depends on an earlier one.
export function parse(markdown) {
  const tokens = new DispatchLexer(getDefaults()).lex(markdown);
  return Parser.parse(tokens, getDefaults());
}
