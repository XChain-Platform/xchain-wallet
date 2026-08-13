// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// - tests for the forced-colors (Windows high-contrast) audit.
//
// Two halves, and the first is the one that matters. A "0 violations" gate is
// worthless unless the same rules are shown FAILING on the real shapes they
// exist to catch, so every rule below is driven with the exact stylesheet
// pattern the forced-colors walk found in this repo, then with the fix that
// closed it. Without that, the tree-wide assertion at the bottom could pass
// because the audit does nothing.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    CARVE_OUTS,
    auditFile,
    classifyColor,
    parseRules,
    readDeclaredTokens,
    readForcedColorTokens,
    runForcedColorsAudit,
    splitDeclarations,
    stripComments,
} from '../../../packages/core/scripts/forced-colors-audit.js';

const tokens = readForcedColorTokens();

/** @param {string} css */
const audit = (css) => auditFile('/repo/packages/core/src/ui/Fixture.module.css', css, tokens);
const rules = (css) => audit(css).map((v) => v.rule);

describe('forced-colors audit: the CSS scanner', () => {
    it('blanks comments without moving any line number', () => {
        const css = '.a {\n/* two\n   lines */\ncolor: red;\n}';
        expect(stripComments(css).split('\n')).toHaveLength(css.split('\n').length);
    });

    it('does not let a comment swallow the declaration after it', () => {
        // The bug this guards: a prose comment between two declarations was
        // glued onto the next one, so `--xc-on-accent` read as an unmapped
        // token and every rule using it was reported as broken.
        const decls = splitDeclarations(stripComments('/* why */\n--xc-on-accent: Canvas;\ncolor: red;'));
        expect(decls).toEqual([
            { prop: '--xc-on-accent', value: 'Canvas' },
            { prop: 'color', value: 'red' },
        ]);
    });

    it('remembers which at-rules a block sits inside', () => {
        const parsed = parseRules('@media (forced-colors: active) {\n.x { color: Canvas; }\n}\n.y { color: red; }');
        expect(parsed.map((r) => [r.selector, r.at.length])).toEqual([['.x', 1], ['.y', 0]]);
    });
});

describe('forced-colors audit: which values survive the mode', () => {
    it('treats a system colour as preserved and an author colour as forced', () => {
        expect(classifyColor('Canvas', tokens).kind).toBe('preserved');
        expect(classifyColor('#FFFFFF', tokens).kind).toBe('forced');
        expect(classifyColor('rgba(255, 255, 255, 0.2)', tokens).kind).toBe('forced');
    });

    it('resolves a token through the forced-colors block in tokens.css', () => {
        expect(classifyColor('var(--xc-accent-primary)', tokens)).toEqual({ kind: 'preserved', color: 'LinkText' });
        expect(classifyColor('var(--xc-on-accent)', tokens)).toEqual({ kind: 'preserved', color: 'Canvas' });
    });

    it('reads an unmapped token as forced, fallback and all', () => {
        expect(classifyColor('var(--xc-shadow-md)', tokens).kind).toBe('forced');
        expect(classifyColor('var(--xc-nope, #333)', tokens).kind).toBe('forced');
    });

    it('leaves transparent and currentColor alone', () => {
        expect(classifyColor('transparent', tokens).kind).toBe('neutral');
        expect(classifyColor('currentColor', tokens).kind).toBe('neutral');
    });
});

describe('FC0 undefined-token', () => {
    const declared = new Set(['--xc-focus-ring', '--xc-text', '--xc-accent-primary']);
    const withTokens = (css) => auditFile('/repo/packages/core/src/ui/Fixture.module.css', css, tokens, declared)
        .map((v) => v.rule);

    it('flags a var() naming a token nothing declares', () => {
        // The InfoTip ring: `--xc-accent` has never existed, so the whole
        // `outline` shorthand was invalid and the control had no ring at all.
        expect(withTokens('.glyph { outline: 2px solid var(--xc-accent); }'))
            .toEqual(['undefined-token']);
    });

    it('accepts a declared token, and a fallback on an undeclared one', () => {
        expect(withTokens('.glyph { outline: 2px solid var(--xc-focus-ring); }')).toEqual([]);
        expect(withTokens('.glyph { color: var(--xc-someday, #333); }')).toEqual([]);
    });

    it('checks inside forced-colors blocks too', () => {
        expect(withTokens(`
            @media (forced-colors: active) {
                .glyph { outline: 2px solid var(--xc-nope); }
            }
        `)).toEqual(['undefined-token']);
    });

    it('does not mistake a declaration of a token for a use of one', () => {
        expect(withTokens(':root { --xc-brand-new: #fff; }')).toEqual([]);
    });
});

describe('FC1 focus-indicator-erased', () => {
    it('flags a box-shadow ring, which forced-colors mode does not paint', () => {
        expect(rules(`
            .input:focus {
                outline: none;
                border-color: var(--xc-accent-primary);
                box-shadow: 0 0 0 3px var(--xc-focus-ring);
            }
        `)).toEqual(['focus-indicator-erased']);
    });

    it('flags a focus state that is only a background tint', () => {
        // Every surface token maps to Canvas, so the tint has nothing left.
        expect(rules('.row:hover, .row:focus-visible { background: var(--xc-bg-muted); outline: none; }'))
            .toEqual(['focus-indicator-erased']);
    });

    it('flags a focus state that is only a colour change', () => {
        expect(rules('.icon:focus-visible { outline: none; color: var(--xc-text); }'))
            .toEqual(['focus-indicator-erased']);
    });

    it('accepts an outline restored for the mode', () => {
        expect(rules(`
            .input:focus { outline: none; box-shadow: 0 0 0 3px var(--xc-focus-ring); }
            @media (forced-colors: active) {
                .input:focus { outline: 2px solid Highlight; outline-offset: 2px; }
            }
        `)).toEqual([]);
    });

    it('accepts an outline restored by a later plain rule', () => {
        // The LeftNav / BottomTabBar shape: one rule strips the ring for the
        // hover half, the next puts a real one back for focus.
        expect(rules(`
            .item:hover, .item:focus-visible { background: var(--xc-surface); outline: none; }
            .item:focus-visible { outline: 2px solid var(--xc-accent-primary); outline-offset: -2px; }
        `)).toEqual([]);
    });

    it('accepts a ring drawn on the pip instead of the hit box', () => {
        // InfoTip and OnboardingCarousel deliberately ring an inner element so
        // a 16px dot does not get a 24px square around it.
        expect(rules(`
            .dot:focus-visible { outline: none; }
            .dot:focus-visible::before { outline: 2px solid var(--xc-focus-ring); outline-offset: 2px; }
        `)).toEqual([]);
    });

    it('says nothing about a focus rule that keeps the outline', () => {
        expect(rules('.btn:focus-visible { outline: 2px solid var(--xc-focus-ring); }')).toEqual([]);
    });
});

describe('FC2 mixed-forced-pair', () => {
    it('flags a preserved fill under a forced label', () => {
        // The wallet's primary button before: a LinkText fill with a
        // label the browser drags to CanvasText.
        expect(rules('.primary { background: var(--xc-accent-primary); color: #FFFFFF; }'))
            .toEqual(['mixed-forced-pair']);
    });

    it('accepts the paired token that fixed it', () => {
        expect(rules('.primary { background: var(--xc-accent-primary); color: var(--xc-on-accent); }'))
            .toEqual([]);
    });

    it('flags text that lands on its own background colour', () => {
        expect(rules('.ghost { background: var(--xc-border); color: var(--xc-text); }'))
            .toEqual(['mixed-forced-pair']);
    });

    it('ignores a forced label on a Canvas-like surface, which stays readable', () => {
        expect(rules('.card { background: var(--xc-surface); color: #333333; }')).toEqual([]);
    });

    it('ignores a transparent or inherited half', () => {
        expect(rules('.plain { background: transparent; color: #FFFFFF; }')).toEqual([]);
        expect(rules('.plain { background: var(--xc-danger); color: inherit; }')).toEqual([]);
    });

    it('accepts a pair pinned in a forced-colors block', () => {
        expect(rules(`
            .pill { background: var(--xc-accent-primary); color: #FFFFFF; }
            @media (forced-colors: active) {
                .pill { background: Highlight; color: HighlightText; }
            }
        `)).toEqual([]);
    });
});

describe('FC3 gradient-surface-unpinned', () => {
    it('flags a gradient surface that sets its own text colour', () => {
        expect(rules('.hero { background: linear-gradient(180deg, var(--xc-accent-primary), #000); color: #FFFFFF; }'))
            .toEqual(['gradient-surface-unpinned']);
    });

    it('accepts one that pins both halves for the mode', () => {
        expect(rules(`
            .hero { background: linear-gradient(180deg, var(--xc-accent-primary), #000); color: #FFFFFF; }
            @media (forced-colors: active) {
                .hero { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
            }
        `)).toEqual([]);
    });
});

describe('forced-colors audit: the carve-outs', () => {
    it('suppresses exactly the selector it names, and nothing else in the file', () => {
        const skipLinkTarget = auditFile(
            '/repo/packages/core/src/ui/Screen.module.css',
            '.body:focus { outline: none; }\n.other:focus { outline: none; }',
            tokens,
        );
        expect(skipLinkTarget.map((v) => v.snippet)).toEqual(['.other:focus']);
    });

    it('gives every carve-out a reason, so the list can be read out loud', () => {
        for (const carveOut of CARVE_OUTS) {
            expect(carveOut.reason.length).toBeGreaterThan(40);
            expect(carveOut.rule).toBeTruthy();
        }
    });
});

describe('forced-colors audit: the wallet itself', () => {
    it('maps both halves of every filled surface it defines a token for', () => {
        // A fill token without its label token is the FC2 defect waiting to
        // happen, so the pairing is asserted rather than left to review.
        expect(tokens['--xc-accent-primary']).toBe('LinkText');
        expect(tokens['--xc-on-accent']).toBe('Canvas');
        expect(tokens['--xc-danger']).toBe('Mark');
        expect(tokens['--xc-on-danger']).toBe('MarkText');
    });

    it('counts a custom property set from JSX as declared', () => {
        // ChainBadge hands `--chain-color` to an element as an inline style;
        // a token scan that only read CSS would call every use of it broken.
        // Walk up from the cwd rather than off `import.meta.url`: under the
        // jsdom environment that URL is an http: one, and `fileURLToPath`
        // rejects it.
        let dir = process.cwd();
        while (!existsSync(join(dir, 'packages', 'core', 'src'))) {
            const up = dirname(dir);
            if (up === dir) throw new Error('packages/core/src not found above the cwd');
            dir = up;
        }
        const declared = readDeclaredTokens([join(dir, 'packages', 'core', 'src')]);
        expect(declared.has('--chain-color')).toBe(true);
        expect(declared.has('--xc-accent-primary')).toBe(true);
    });

    it('has no violations in any package stylesheet', () => {
        const violations = runForcedColorsAudit();
        expect(
            violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.snippet}`).join('\n'),
        ).toBe('');
    });
});
