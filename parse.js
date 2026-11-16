// fast-marked — a faster drop-in for marked 18.1.3.
//
// The entry is a fork of marked (MIT, see vendor/marked/). marked's own
// tokenizer methods still build every token, which is what keeps the HTML
// byte-identical, but the two dispatch loops that drive them are rewritten:
//
//   * The block loop looks at the first character of the remaining text and
//     only tries the block rules that can start with it (a `#` line can only
//     be a heading, a table, a setext heading or a paragraph, never a list
//     or a blockquote, so those regexes are never run). A table, a setext
//     heading, a paragraph and plain text stay on the candidate list for
//     every line, because their first line can start with anything.
//   * The inline loop does the same per character: a backslash can only be
//     an escape, a backtick can only open a code span, `[` can only start
//     a link, and so on. Plain text is still consumed by marked's own
//     inlineText, so a run of ordinary words costs one match.
//
// The emphasis masking marked performs before its inline loop is reproduced
// here (same regexes, same replacements), because emStrong and del scan the
// masked copy for their closers. The only thing this file cannot reuse is
// marked's internal closer cache, so an emphasis run re-scans the masked
// text once per delimiter; paragraphs are short, so that stays cheap.

import { Lexer, Parser, Tokenizer, getDefaults } from './vendor/marked/marked.esm.js';

// How marked normalises a link-reference label: trim it, collapse each run
// of whitespace to a single space, then fold the case in a Unicode-aware way.
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// True when a URL or e-mail address could start with this character code.
// The URL rule matches a scheme (http, https, ftp, www, mailto) or an
// address whose local part uses these characters, so anything outside this
// set can skip the URL attempt entirely.
function canStartUrl(code) {
  if (code >= 48 && code <= 57) return true; // 0-9
  if (code >= 65 && code <= 90) return true; // A-Z
  if (code >= 97 && code <= 122) return true; // a-z
  switch (code) {
    case 33: // !
    case 35: // #
    case 36: // $
    case 37: // %
    case 38: // &
    case 39: // '
    case 42: // *
    case 43: // +
    case 45: // -
    case 46: // .
    case 47: // /
    case 61: // =
    case 63: // ?
    case 94: // ^
    case 95: // _
    case 96: // `
    case 123: // {
    case 124: // |
    case 125: // }
    case 126: // ~
      return true;
    default:
      return false;
  }
}

class FastLexer extends Lexer {
  // Same entry point as marked's lexer, except the carriage-return pass is
  // skipped when the input holds no carriage return at all (the replace
  // would be a no-op there, but the regex would still scan the whole text).
  lex(src) {
    if (src.includes('\r')) {
      src = src.replace(this.tokenizer.rules.other.carriageReturn, '\n');
    }
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) {
      const item = this.inlineQueue[i];
      this.state.inRawBlock = false;
      this.inlineTokens(item.src, item.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }

  // Block tokenisation with a first-character dispatch. The candidate rules
  // are always tried in marked's own order; the dispatch only drops the
  // ones whose pattern cannot start with the character at hand. Paragraph
  // and plain text are always candidates, and a table and a setext heading
  // are too, because either can begin with any character.
  blockTokens(src, tokens = [], cont = false) {
    this.tokenizer.lexer = this;
    const other = this.tokenizer.rules.other;
    if (this.options.pedantic) {
      src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
    }
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
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      const first = src.charCodeAt(0);
      const blank = first === 32 || first === 9; // space or tab
      if ((first === 10 || blank) && (token = this.tokenizer.space(src))) {
        src = src.substring(token.raw.length);
        const prev = tokens.at(-1);
        if (token.raw.length === 1 && prev !== undefined) {
          prev.raw += '\n';
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (blank && (token = this.tokenizer.code(src))) {
        src = src.substring(token.raw.length);
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
      if ((blank || first === 96 || first === 126) && (token = this.tokenizer.fences(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((blank || first === 35) && (token = this.tokenizer.heading(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((blank || first === 45 || first === 95 || first === 42) && (token = this.tokenizer.hr(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((blank || first === 62) && (token = this.tokenizer.blockquote(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((blank || first === 42 || first === 43 || first === 45 || (first >= 48 && first <= 57)) && (token = this.tokenizer.list(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((blank || first === 60) && (token = this.tokenizer.html(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((blank || first === 91) && (token = this.tokenizer.def(src))) {
        src = src.substring(token.raw.length);
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
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if ((token = this.tokenizer.lheading(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
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
        if (cont && prev?.type === 'paragraph') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + token.raw;
          prev.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = prev.text;
        } else {
          tokens.push(token);
        }
        cont = cut.length !== src.length;
        src = src.substring(token.raw.length);
        continue;
      }
      if ((token = this.tokenizer.text(src))) {
        src = src.substring(token.raw.length);
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

  // Inline tokenisation entry point: same link-paren bookkeeping as marked,
  // then the dispatched loop below.
  inlineTokens(src, tokens = []) {
    this.tokenizer.lexer = this;
    const saved = this.state.linkParenPossible;
    this.state.linkParenPossible = saved && src.includes(')');
    try {
      return this.inlineLoop(src, tokens);
    } finally {
      this.state.linkParenPossible = saved;
    }
  }

  // The masked copy emStrong and del scan for their closers. Link and image
  // destinations, code spans and inline HTML are blanked out to same-length
  // placeholders so a `*` inside them never counts as a delimiter, and
  // reference links that resolve are blanked the same way.
  maskInline(src) {
    const rules = this.tokenizer.rules.inline;
    let masked = src;
    if (this.tokens.links && src.includes('[')) {
      const search = rules.reflinkSearch;
      const maskRef = (match) => {
        const open = match.lastIndexOf('[');
        if (!Object.hasOwn(this.tokens.links, normalizeLabel(match.slice(open + 1, -1)))) {
          return match;
        }
        if (open > 1 && match.charAt(0) !== '!') {
          const inner = match.slice(1, open - 1);
          if (this.linkInText(inner)) {
            return '[' + inner.replace(search, maskRef) + '][' + 'a'.repeat(match.length - open - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(match.length - 2) + ']';
      };
      masked = masked.replace(search, maskRef);
    }
    masked = masked.replace(
      rules.anyPunctuationOutsideCode,
      (match, ticks, escaped) => escaped
        ? '+'.repeat(match.length)
        : ticks
          ? ticks + match.slice(ticks.length, -ticks.length).replace(/`/g, '+') + ticks
          : match
    );
    masked = masked.replace(
      rules.blockSkip,
      (match, _ticks, empty) => {
        const lead = empty ? empty.length : 0;
        return match.slice(0, lead) + '[' + 'a'.repeat(match.length - lead - 2) + ']';
      }
    );
    const hook = this.options.hooks?.emStrongMask;
    if (hook) masked = hook.call({ lexer: this }, masked) ?? masked;
    return masked;
  }

  // Inline tokenisation with a first-character dispatch. At each position
  // only the inline rules that can start with that character are tried, in
  // marked's own order; a URL or e-mail is tried whenever the character
  // could start one, and plain text falls through to marked's inlineText.
  // `prevChar` is the last character of the preceding text token (or the
  // empty string when the preceding token was not text), exactly as marked
  // tracks it for its emphasis and strikethrough closers.
  inlineLoop(src, tokens) {
    const tok = this.tokenizer;
    const hasEmphasis = src.includes('*') || src.includes('_') || src.includes('~');
    const customEmphasis = this.options.hooks?.emStrongMask
      || tok.emStrong !== Tokenizer.prototype.emStrong
      || tok.del !== Tokenizer.prototype.del;
    const masked = (hasEmphasis || customEmphasis) ? this.maskInline(src) : src;
    let prevWasText = false;
    let prevChar = '';
    let shortest = Infinity;
    let rest = src;
    while (rest) {
      if (rest.length < shortest) {
        shortest = rest.length;
      } else {
        this.infiniteLoopError(rest.charCodeAt(0));
        break;
      }
      if (!prevWasText) prevChar = '';
      prevWasText = false;
      let token;
      if (this.options.extensions?.inline?.some((ext) => {
        token = ext.call({ lexer: this }, rest, tokens);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      const first = rest.charCodeAt(0);
      const tryUrl = () => {
        if (this.state.inLink) return false;
        const found = tok.url(rest);
        if (!found) return false;
        rest = rest.substring(found.raw.length);
        tokens.push(found);
        return true;
      };
      if (first === 92) { // backslash: escape, then a hard break
        token = tok.escape(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        token = tok.br(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (first === 60) { // <: tag, then autolink
        token = tok.tag(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        token = tok.autolink(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (first === 91 || first === 33) { // [ or !: link, then reference link
        token = tok.link(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        token = tok.reflink(rest, this.tokens.links);
        if (token) {
          rest = rest.substring(token.raw.length);
          const prev = tokens.at(-1);
          if (token.type === 'text' && prev?.type === 'text') {
            prev.raw += token.raw;
            prev.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }
      } else if (first === 42 || first === 95) { // * or _: emphasis
        token = tok.emStrong(rest, masked, prevChar);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if (tryUrl()) continue;
      } else if (first === 96) { // backtick: code span
        token = tok.codespan(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if (tryUrl()) continue;
      } else if (first === 32) { // space: hard break
        token = tok.br(rest);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (first === 126) { // ~: strikethrough
        token = tok.del(rest, masked, prevChar);
        if (token) {
          rest = rest.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if (tryUrl()) continue;
      } else if (canStartUrl(first)) { // letter, digit or e-mail punctuation
        if (tryUrl()) continue;
      }
      token = tok.inlineText(rest);
      if (token) {
        rest = rest.substring(token.raw.length);
        if (token.raw.slice(-1) !== '_') prevChar = token.raw.slice(-1);
        prevWasText = true;
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
  const tokens = new FastLexer(getDefaults()).lex(markdown);
  return Parser.parse(tokens, getDefaults());
}
