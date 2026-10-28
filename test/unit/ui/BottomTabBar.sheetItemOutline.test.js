// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const coreSrc = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src');
const tokensCss = readFileSync(join(coreSrc, 'ui', 'tokens.css'), 'utf8');
const moduleCss = readFileSync(join(coreSrc, 'shared', 'components', 'BottomTabBar.module.css'), 'utf8');

// The global rows-menu reset in tokens.css that zeroes every row edge.
const GLOBAL_RESET = ':root [data-xc-menu-list="rows"] [data-xc-menu-item]';

// Splits `text` on `sep` at parenthesis depth zero.
function splitTop(text, sep) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        else if (ch === sep && depth === 0) {
            out.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(text.slice(start).trim());
    return out.filter(Boolean);
}

// Splits one complex selector into compounds, each with the combinator that
// joins it to the compound on its left.
function compounds(selector) {
    const text = selector.trim().replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ');
    const parts = [];
    let depth = 0;
    let current = '';
    let combinator = ' ';
    for (const ch of text) {
        if (ch === '(' || ch === '[') depth += 1;
        if (ch === ')' || ch === ']') depth -= 1;
        if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
            parts.push({ combinator, text: current });
            current = '';
            combinator = ch;
            continue;
        }
        current += ch;
    }
    parts.push({ combinator, text: current });
    return parts;
}

// Tokens of one compound selector: tag, .class, [attr], :pseudo, ::element or :fn(args).
function simpleSelectors(compound) {
    const tokens = [];
    let i = 0;
    while (i < compound.length) {
        const rest = compound.slice(i);
        let m = rest.match(/^:([\w-]+)\(/);
        if (m) {
            let depth = 1;
            let j = m[0].length;
            while (depth > 0 && j < rest.length) {
                if (rest[j] === '(') depth += 1;
                if (rest[j] === ')') depth -= 1;
                j += 1;
            }
            const kind = ['is', 'not', 'where'].includes(m[1]) ? m[1] : 'fn';
            tokens.push({ kind, name: m[1], args: splitTop(rest.slice(m[0].length, j - 1), ',') });
            i += j;
            continue;
        }
        m = rest.match(/^\[([\w-]+)(?:([~|^$*]?=)["']?([^"'\]]*)["']?)?\]/);
        if (m) { tokens.push({ kind: 'attr', name: m[1], op: m[2], value: m[3] }); i += m[0].length; continue; }
        m = rest.match(/^\.([\w-]+)/);
        if (m) { tokens.push({ kind: 'class', name: m[1] }); i += m[0].length; continue; }
        m = rest.match(/^::([\w-]+)/);
        if (m) { tokens.push({ kind: 'element', name: m[1] }); i += m[0].length; continue; }
        m = rest.match(/^:([\w-]+)/);
        if (m) { tokens.push({ kind: 'pseudo', name: m[1] }); i += m[0].length; continue; }
        m = rest.match(/^([\w-]+|\*)/);
        if (m) { tokens.push({ kind: 'tag', name: m[1] }); i += m[0].length; continue; }
        throw new Error(`unparsed selector text: ${rest}`);
    }
    return tokens;
}

function addSpec(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function cmpSpec(a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; }

/** Specificity of one complex selector as [ids, classes, types]. */
function specificity(selector) {
    let total = [0, 0, 0];
    for (const { text } of compounds(selector)) {
        for (const token of simpleSelectors(text)) {
            if (['class', 'attr', 'pseudo', 'fn'].includes(token.kind)) total = addSpec(total, [0, 1, 0]);
            else if (token.kind === 'element' || (token.kind === 'tag' && token.name !== '*')) total = addSpec(total, [0, 0, 1]);
            else if (token.kind === 'is' || token.kind === 'not') {
                total = addSpec(total, token.args.map(specificity).sort(cmpSpec).at(-1));
            }
        }
    }
    return total;
}

function matchToken(token, el) {
    switch (token.kind) {
    case 'tag': return token.name === '*' || token.name === el.tag;
    case 'class': return el.classes.includes(token.name);
    case 'attr':
        if (!(token.name in el.attrs)) return false;
        if (token.op === undefined) return true;
        return token.op === '=' && el.attrs[token.name] === token.value;
    case 'pseudo':
        if (token.name === 'root') return el.tag === 'html';
        return el.states.includes(token.name);
    case 'is':
    case 'where': return token.args.some((arg) => compounds(arg).length === 1 && matchCompound(arg, el));
    case 'not': return !token.args.some((arg) => compounds(arg).length === 1 && matchCompound(arg, el));
    // Pseudo-elements and other functional pseudo-classes never match the row box itself.
    default: return false;
    }
}

function matchCompound(text, el) {
    return simpleSelectors(text).every((token) => matchToken(token, el));
}

// Matches a complex selector against `chain`, the element first and then its ancestors.
function matches(selector, chain) {
    const parts = compounds(selector);
    function walk(partIndex, chainIndex) {
        const part = parts[partIndex];
        if (!matchCompound(part.text, chain[chainIndex])) return false;
        if (partIndex === 0) return true;
        if (part.combinator === '>') return chainIndex + 1 < chain.length && walk(partIndex - 1, chainIndex + 1);
        if (part.combinator !== ' ') return false;
        for (let k = chainIndex + 1; k < chain.length; k += 1) if (walk(partIndex - 1, k)) return true;
        return false;
    }
    return walk(parts.length - 1, 0);
}

// Splits a border shorthand value into width, style and color.
function parseBorder(value) {
    const words = splitTop(value.replace(/\s+/g, ' '), ' ');
    const out = { width: '0', style: 'none', color: 'currentcolor' };
    const extra = [];
    for (const word of words) {
        if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(word)) out.style = word;
        else if (/^(0|[\d.]+(px|rem|em)|thin|medium|thick)$/.test(word)) out.width = word;
        else extra.push(word);
    }
    if (extra.length) out.color = extra.join(' ');
    return out;
}

const SIDES = ['top', 'right', 'bottom', 'left'];

// Every flat (non-@media) rule of both sheets, tokens first, in source order.
function flatRules() {
    const rules = [];
    for (const source of [tokensCss, moduleCss]) {
        postcss.parse(source).walkRules((rule) => {
            if (rule.parent?.type === 'atrule') return;
            const decls = rule.nodes.filter((node) => node.type === 'decl');
            for (const selector of rule.selectors) rules.push({ selector: selector.replace(/\s+/g, ' ').trim(), decls });
        });
    }
    return rules;
}

/** The resolved border longhands of one More-sheet row in the given states. */
function resolvedBorder(states) {
    const chain = [
        // A focus-visible row also matches :focus, and an idle native button matches :enabled.
        { tag: 'button', classes: ['sheetItem'], attrs: { type: 'button', 'data-xc-menu-item': '' }, states: [...states, ...(states.includes('focus-visible') ? ['focus'] : []), 'enabled'] },
        { tag: 'li', classes: [], attrs: {}, states: [] },
        { tag: 'ul', classes: ['sheetList'], attrs: { role: 'list', 'data-xc-menu-list': 'rows' }, states: [] },
        { tag: 'div', classes: [], attrs: {}, states: [] },
        { tag: 'body', classes: [], attrs: {}, states: [] },
        { tag: 'html', classes: [], attrs: {}, states: [] },
    ];
    const winners = {};
    flatRules().forEach(({ selector, decls }, order) => {
        if (!matches(selector, chain)) return;
        const spec = specificity(selector);
        const set = (prop, value) => {
            const prev = winners[prop];
            if (!prev || cmpSpec(spec, prev.spec) >= 0) winners[prop] = { value, spec, selector, order };
        };
        for (const { prop, value } of decls) {
            if (prop === 'border') {
                const b = parseBorder(value);
                for (const side of SIDES) {
                    set(`${side}-width`, b.width);
                    set(`${side}-style`, b.style);
                    set(`${side}-color`, b.color);
                }
            } else if (/^border-(color|style|width)$/.test(prop)) {
                const field = prop.slice('border-'.length);
                if (splitTop(value, ' ').length !== 1) throw new Error(`multi-value ${prop} is not modelled: ${value}`);
                for (const side of SIDES) set(`${side}-${field}`, value.trim());
            } else if (/^border-(top|right|bottom|left)$/.test(prop)) {
                const b = parseBorder(value);
                const side = prop.slice('border-'.length);
                set(`${side}-width`, b.width);
                set(`${side}-style`, b.style);
                set(`${side}-color`, b.color);
            } else if (/^border-(top|right|bottom|left)-(color|style|width)$/.test(prop)) {
                set(prop.slice('border-'.length), value.trim());
            } else if (/^border-(inline|block)/.test(prop)) {
                throw new Error(`logical border ${prop} is not modelled; extend this test`);
            }
        }
    });
    return winners;
}

const visibleEdge = (winners, side) => {
    const width = winners[`${side}-width`]?.value ?? '0';
    const style = winners[`${side}-style`]?.value ?? 'none';
    const color = winners[`${side}-color`]?.value ?? 'currentcolor';
    return parseFloat(width) >= 1 && style === 'solid' && color !== 'transparent';
};

// A More-sheet row sits on the sheet surface, and its hover fill is close to
// white, so hover and keyboard focus draw a 1px control edge. The global
// rows-menu reset in tokens.css zeroes that edge, so the module rules must
// outrank it in the cascade.
describe('More sheet row outline', () => {
    it('reads the global rows-menu reset at its expected specificity', () => {
        expect(tokensCss.replace(/\s+/g, ' ')).toContain(`${GLOBAL_RESET} {`);
        expect(specificity(GLOBAL_RESET)).toEqual([0, 3, 0]);
    });

    for (const state of ['hover', 'focus-visible']) {
        it(`resolves a visible 1px edge on ${state} over the global reset`, () => {
            const winners = resolvedBorder([state]);
            for (const side of SIDES) {
                expect(visibleEdge(winners, side), `${side} edge on ${state}`).toBe(true);
                expect(winners[`${side}-color`].value).toBe('var(--xc-control-border)');
                for (const field of ['width', 'style', 'color']) {
                    const won = winners[`${side}-${field}`];
                    expect(won.selector, `${side}-${field} comes from the module`).toMatch(/\.sheetItem/);
                    expect(cmpSpec(won.spec, specificity(GLOBAL_RESET)), `${won.selector} vs the global reset`).toBeGreaterThan(0);
                }
            }
        });
    }

    it('keeps the idle edge transparent at the same width, so hover does not shift the row', () => {
        const idle = resolvedBorder([]);
        const hover = resolvedBorder(['hover']);
        for (const side of SIDES) {
            expect(idle[`${side}-color`].value).toBe('transparent');
            expect(idle[`${side}-width`].value).toBe(hover[`${side}-width`].value);
        }
    });

    it('keeps a visible keyboard focus ring', () => {
        const focus = postcss.parse(moduleCss).nodes
            .find((node) => node.type === 'rule' && node.selector.trim() === '.sheetItem:focus-visible');
        expect(focus).toBeTruthy();
        expect(focus.toString()).toMatch(/outline:\s*2px solid /);
    });
});
