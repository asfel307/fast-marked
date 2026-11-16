// fast-marked: a faster drop-in for marked 18.1.3.
//
// parse(markdown) returns exactly the HTML marked 18.1.3 renders with its
// default options (gfm true, breaks false, pedantic false, async false),
// byte for byte, for every input. It is a fork of marked itself (MIT,
// vendor/marked/, credited in README.md) with the two hot tokenizing loops
// rewritten: the inline loop and the block loop dispatch on the first
// character instead of trying every tokenizer in turn, so a plain-text run
// costs one regex instead of ten. No output logic changed anywhere.

import { Lexer, Parser, Tokenizer, getDefaults } from './vendor/marked/marked.esm.js';

// The defaults marked.parse uses: gfm on, breaks off, pedantic off,
// async off, no extensions, no hooks, no custom renderer or tokenizer.
const sharedDefaults = getDefaults();

/**
 * The first line of `s`: the part before the first '\n', or the whole
 * string when it holds none. Cheaper than s.split('\n', 1)[0], which
 * builds an array for the same answer.
 */
function firstLineOf(s) {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

/**
 * Expand tabs in `line` to spaces, counting columns from `indent`.
 * (marked's own expandTabs, reimplemented: it is not exported.)
 */
function expandTabs(line, indent = 0) {
  let col = indent;
  let expanded = '';
  for (const char of line) {
    if (char === '\t') {
      const added = 4 - (col % 4);
      expanded += ' '.repeat(added);
      col += added;
    } else {
      expanded += char;
      col++;
    }
  }
  return expanded;
}

/**
 * The first non-space character of a list-item line, as a code, for
 * dispatching the block-start tests: block-start regexes allow at most
 * `indent` leading spaces, so a marker further in, a tab in the marker
 * seat, or a blank line can start none of them, and -1 is returned.
 */
function listLineMarker(line, indent) {
  let sp = 0;
  while (sp < line.length && line.charCodeAt(sp) === 32) {
    sp++;
  }
  if (sp > indent) {
    return -1;
  }
  const c = line.charCodeAt(sp);
  if (c === 9 || Number.isNaN(c)) {
    return -1;
  }
  return c;
}

/**
 * A Tokenizer whose list method is marked's own with the per-line work
 * trimmed: first-line slices instead of split(), leading-whitespace
 * expansion only when the line starts with a space or tab, and the six
 * block-start tests dispatched on the line's first non-space character.
 * The logic and the order of every check are marked's own.
 */
class FastTokenizer extends Tokenizer {
  list(src) {
    const other = this.rules.other;
    const block = this.rules.block;
    let cap = block.list.exec(src);
    if (cap) {
      const listSrc = src;
      const taken = () => listSrc.length - src.length;
      let bull = cap[1].trim();
      const isordered = bull.length > 1;

      const list = {
        type: 'list',
        raw: '',
        ordered: isordered,
        start: isordered ? +bull.slice(0, -1) : '',
        loose: false,
        items: [],
      };

      bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;

      if (this.options.pedantic) {
        bull = isordered ? bull : '[*+-]';
      }

      const itemRegex = other.listItemRegex(bull);
      let endsWithBlankLine = false;
      while (src) {
        let endEarly = false;
        let itemContents = '';
        if (!(cap = itemRegex.exec(src))) {
          break;
        }

        if (block.hr.test(src)) {
          break;
        }

        const itemStart = taken();
        src = src.substring(cap[0].length);

        const firstLine = firstLineOf(cap[2]);
        const bulletIndent = cap[1].length;
        const firstChar = firstLine.charCodeAt(0);
        let line = this.options.pedantic
          ? expandTabs(firstLine, bulletIndent)
          : (firstChar === 32 || firstChar === 9)
            ? firstLine.replace(other.leadingSpaceTab, whitespace => expandTabs(whitespace, bulletIndent))
            : firstLine;
        let nextLine = firstLineOf(src);
        let blankLine = !line.trim();

        let indent = 0;
        if (this.options.pedantic) {
          indent = 2;
          itemContents = line.trimStart();
        } else if (blankLine) {
          indent = bulletIndent + 1;
        } else {
          indent = line.search(other.nonSpaceChar);
          indent = indent > 4 ? 1 : indent;
          itemContents = line.slice(indent);
          indent += bulletIndent;
        }

        if (blankLine && other.blankLine.test(nextLine)) {
          src = src.substring(nextLine.length + 1);
          endEarly = true;
        }

        if (!endEarly) {
          const nextBulletRegex = other.nextBulletRegex(indent);
          const hrRegex = other.hrRegex(indent);
          const fencesBeginRegex = other.fencesBeginRegex(indent);
          const headingBeginRegex = this.options.pedantic
            ? other.pedanticHeadingBeginRegex(indent)
            : other.headingBeginRegex(indent);
          const htmlBeginRegex = other.htmlBeginRegex(indent);
          const blockquoteBeginRegex = other.blockquoteBeginRegex(indent);

          while (src) {
            const rawLine = firstLineOf(src);
            let nextLineWithoutTabs;
            nextLine = rawLine;

            if (this.options.pedantic) {
              nextLine = nextLine.replace(other.listReplaceNesting, '  ');
              nextLineWithoutTabs = nextLine;
            } else {
              const lineChar = nextLine.charCodeAt(0);
              nextLineWithoutTabs = (lineChar === 32 || lineChar === 9)
                ? nextLine.replace(other.leadingSpaceTab, whitespace => expandTabs(whitespace))
                : nextLine;
            }

            const marker = listLineMarker(nextLine, indent);
            if (marker === 96 || marker === 126) {
              if (fencesBeginRegex.test(nextLine)) {
                break;
              }
            } else if (marker === 35) {
              if (headingBeginRegex.test(nextLine)) {
                break;
              }
            } else if (marker === 60) {
              if (htmlBeginRegex.test(nextLine)) {
                break;
              }
            } else if (marker === 62) {
              if (blockquoteBeginRegex.test(nextLine)) {
                break;
              }
            } else if (marker === 42 || marker === 45) {
              if (nextBulletRegex.test(nextLine)) {
                break;
              }
              if (hrRegex.test(nextLine)) {
                break;
              }
            } else if (marker === 43 || (marker >= 48 && marker <= 57)) {
              if (nextBulletRegex.test(nextLine)) {
                break;
              }
            } else if (marker === 95) {
              if (hrRegex.test(nextLine)) {
                break;
              }
            }

            if (nextLineWithoutTabs.search(other.nonSpaceChar) >= indent || !nextLine.trim()) {
              itemContents += '\n' + nextLineWithoutTabs.slice(indent);
            } else {
              if (blankLine) {
                break;
              }

              if ((line.includes('\t') ? line.replace(other.tabCharGlobal, '    ') : line).search(other.nonSpaceChar) >= 4) {
                break;
              }
              const lineMarker = listLineMarker(line, indent);
              if (lineMarker === 96 || lineMarker === 126) {
                if (fencesBeginRegex.test(line)) {
                  break;
                }
              } else if (lineMarker === 35) {
                if (headingBeginRegex.test(line)) {
                  break;
                }
              } else if (lineMarker === 60) {
                if (htmlBeginRegex.test(line)) {
                  break;
                }
              } else if (lineMarker === 45 || lineMarker === 95 || lineMarker === 42) {
                if (hrRegex.test(line)) {
                  break;
                }
              }

              const setextContinuation = !this.options.pedantic
                && /^ {0,3}(?:=+|-+) *$/.test(nextLine)
                && block.lheading.test(`${line}\n${nextLine}`);
              const continuation = setextContinuation
                ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
                : nextLine;
              itemContents += '\n' + continuation;
            }

            blankLine = !nextLine.trim();

            src = src.substring(rawLine.length + 1);
            line = nextLineWithoutTabs.slice(indent);
          }
        }

        const raw = listSrc.slice(itemStart, taken());

        if (!list.loose) {
          if (endsWithBlankLine) {
            list.loose = true;
          } else if (other.doubleBlankLine.test(raw)) {
            endsWithBlankLine = true;
          }
        }

        list.items.push({
          type: 'list_item',
          raw,
          task: !!this.options.gfm && other.listIsTask.test(itemContents),
          loose: false,
          text: itemContents,
          tokens: [],
        });
      }

      const lastItem = list.items.at(-1);
      if (lastItem) {
        lastItem.raw = lastItem.raw.trimEnd();
        lastItem.text = lastItem.text.trimEnd();
      } else {
        return;
      }
      list.raw = listSrc.slice(0, taken()).trimEnd();

      for (const item of list.items) {
        this.lexer.state.top = false;
        item.tokens = this.lexer.blockTokens(item.text, []);

        if (!list.loose) {
          const spacers = item.tokens.filter(t => t.type === 'space');
          const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => other.anyLine.test(t.raw));

          list.loose = hasMultipleLineBreaks;
        }
      }

      for (const item of list.items) {
        const itemToken = item.tokens[0];
        if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
          item.text = item.text.replace(other.listReplaceTask, '');
          itemToken.raw = itemToken.raw.replace(other.listReplaceTask, '');
          itemToken.text = itemToken.text.replace(other.listReplaceTask, '');
          for (let i = this.lexer.inlineQueue.length - 1; i >= 0; i--) {
            if (other.listIsTask.test(this.lexer.inlineQueue[i].src)) {
              this.lexer.inlineQueue[i].src = this.lexer.inlineQueue[i].src.replace(other.listReplaceTask, '');
              break;
            }
          }

          const taskRaw = other.listTaskCheckbox.exec(item.raw);
          if (taskRaw) {
            const checkboxToken = {
              type: 'checkbox',
              raw: taskRaw[0] + ' ',
              checked: taskRaw[0] !== '[ ]',
            };
            item.checked = checkboxToken.checked;
            if (list.loose) {
              if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
                item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw;
                item.tokens[0].text = checkboxToken.raw + item.tokens[0].text;
                item.tokens[0].tokens.unshift(checkboxToken);
              } else {
                item.tokens.unshift({
                  type: 'paragraph',
                  raw: checkboxToken.raw,
                  text: checkboxToken.raw,
                  tokens: [checkboxToken],
                });
              }
            } else {
              item.tokens.unshift(checkboxToken);
            }
          }
        } else if (item.task) {
          item.task = false;
        }
      }

      if (list.loose) {
        for (const item of list.items) {
          item.loose = true;
          for (const token of item.tokens) {
            if (token.type === 'text') {
              token.type = 'paragraph';
            }
          }
        }
      }

      return list;
    }
  }
}

/**
 * A Lexer whose two tokenizing loops dispatch on the first character.
 * Every tokenizer it calls is marked's own, in marked's own order, so the
 * tokens (and therefore the HTML) are identical; only tokenizers that
 * cannot match at the current position are skipped.
 */
class FastLexer extends Lexer {
  /**
   * Inline tokens for `src`, appended to `tokens`.
   * Runs with no '*', '_' or '~' take the dispatched fast loop below;
   * anything else goes through marked's own inline pass (masked source,
   * closer scan and all), unchanged.
   */
  inlineTokens(src, tokens = []) {
    this.tokenizer.lexer = this;
    if (
      !this.options.hooks?.emStrongMask
      && !src.includes('*')
      && !src.includes('_')
      && !src.includes('~')
    ) {
      return this.fastInlineTokens(src, tokens);
    }
    return super.inlineTokens(src, tokens);
  }

  /**
   * The inline loop for a run that holds no emphasis, strong or
   * strikethrough delimiter. Without '*', '_' or '~' the emStrong and del
   * tokenizers cannot match, so the run needs no masked source and no
   * closer scan; a first-character dispatch then skips every other
   * tokenizer that cannot start at the current position, leaving the
   * single text regex for plain runs. The loop otherwise follows
   * marked's #tokenizeInlines step for step: same order, same state
   * (linkParenPossible, inLink, prevChar), same token merging.
   */
  fastInlineTokens(src, tokens) {
    const prevLinkParenPossible = this.state.linkParenPossible;
    this.state.linkParenPossible = prevLinkParenPossible && src.includes(')');
    try {
      let keepPrevChar = false;
      let prevChar = '';
      let srcLength = Infinity;
      while (src) {
        if (src.length < srcLength) {
          srcLength = src.length;
        } else {
          this.infiniteLoopError(src.charCodeAt(0));
          break;
        }
        if (!keepPrevChar) {
          prevChar = '';
        }
        keepPrevChar = false;

        let token;

        // Inline extensions, if any (none under the defaults).
        if (this.options.extensions?.inline?.some((extTokenizer) => {
          if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            return true;
          }
          return false;
        })) {
          continue;
        }

        const ch = src.charCodeAt(0);
        if (ch === 92) {
          // Backslash: escape, then br (backslash + newline is a hard
          // break), else text.
          if (token = this.tokenizer.escape(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.br(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        } else if (ch === 60) {
          // '<': tag, then autolink, else text.
          if (token = this.tokenizer.tag(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.autolink(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        } else if (ch === 91 || ch === 33) {
          // '[' or '!': link, then reflink, else text.
          if (token = this.tokenizer.link(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
          if (token = this.tokenizer.reflink(src, this.tokens.links)) {
            src = src.substring(token.raw.length);
            const lastToken = tokens.at(-1);
            if (token.type === 'text' && lastToken?.type === 'text') {
              lastToken.raw += token.raw;
              lastToken.text += token.text;
            } else {
              tokens.push(token);
            }
            continue;
          }
        } else if (ch === 96) {
          // Backtick: only codespan can start here, else text.
          if (token = this.tokenizer.codespan(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        } else if (ch === 32) {
          // Space: only br (two spaces + newline) can start here, else text.
          if (token = this.tokenizer.br(src)) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        } else if (
          (ch >= 48 && ch <= 57) // 0-9
          || (ch >= 65 && ch <= 90) // A-Z
          || (ch >= 97 && ch <= 122) // a-z
          || ch === 46 // .
          || ch === 95 // _
          || ch === 43 // +
          || ch === 45 // -
        ) {
          // A url or bare email can only start on a letter, a digit, or
          // '.', '_', '+' or '-'; try it (unless inside a link), else text.
          if (!this.state.inLink && (token = this.tokenizer.url(src))) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        }
        // Anything else can only be text.

        // Text, with the extensions startInline clipping kept for parity.
        let cutSrc = src;
        if (this.options.extensions?.startInline) {
          let startIndex = Infinity;
          const tempSrc = src.slice(1);
          let tempStart;
          this.options.extensions.startInline.forEach((getStartIndex) => {
            tempStart = getStartIndex.call({ lexer: this }, tempSrc);
            if (typeof tempStart === 'number' && tempStart >= 0) {
              startIndex = Math.min(startIndex, tempStart);
            }
          });
          if (startIndex < Infinity && startIndex >= 0) {
            cutSrc = src.substring(0, startIndex + 1);
          }
        }
        if (token = this.tokenizer.inlineText(cutSrc)) {
          src = src.substring(token.raw.length);
          if (token.raw.slice(-1) !== '_') {
            prevChar = token.raw.slice(-1);
          }
          keepPrevChar = true;
          const lastToken = tokens.at(-1);
          if (lastToken?.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
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
      return tokens;
    } finally {
      this.state.linkParenPossible = prevLinkParenPossible;
    }
  }
}

/**
 * The HTML marked 18.1.3 renders for `markdown`, with marked's defaults.
 * A fresh lexer and parser per call, exactly as marked.parse does; the
 * shared defaults object is shallow-copied per call so the tokenizer and
 * renderer instances are shared, as marked does.
 */
export function parse(markdown) {
  const opt = { ...sharedDefaults, tokenizer: new FastTokenizer() };
  const lexer = new FastLexer(opt);
  const tokens = lexer.lex(markdown);
  const parser = new Parser(opt);
  return parser.parse(tokens);
}
