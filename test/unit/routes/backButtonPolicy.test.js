// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Back button policy over the whole route registry (G06, which revises
// U17's per-surface lists). Back follows the shell's one history: a page
// opened from another page shows Back, and a root page (opened from the
// sidebar, the bottom bar, the menu or the palette) shows none, whichever
// nav surface is on screen. A sub-screen that steps back inside its page
// always shows Back, and outside a shell Back always shows. Every registered
// route is rendered under each surface and both history states.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import { NavHistoryContext } from '../../../packages/core/src/ui/navHistory.js';
import {
    CurrentRouteContext,
    NavSurfaceContext,
} from '../../../packages/core/src/shared/components/navSurface.js';
import { ROUTE_REGISTRY, TAB_BAR_DESTINATIONS } from '../../../packages/core/src/shared/routeRegistry.js';

/** The five bottom-bar tabs the wallet menu catalogue names. */
const PHONE_TABS = ['home', 'send', 'receive', 'history', 'settings'];

/** Whether the ruling shows Back: on any page opened from another page, or a sub-screen. */
function rulingShowsBack(canGoBack, nested) {
    return nested || canGoBack;
}

const BACK = { name: 'Back to previous screen' };
const routeIds = Object.keys(ROUTE_REGISTRY);

function showsBack(surface, routeId, canGoBack, nested) {
    render(h(
        NavSurfaceContext.Provider,
        { value: surface },
        h(
            CurrentRouteContext.Provider,
            { value: routeId },
            h(
                NavHistoryContext.Provider,
                { value: { canGoBack } },
                h(PageHeader, { title: 'Screen', onBack: () => {}, nested }),
            ),
        ),
    ));
    const shown = screen.queryByRole('button', BACK) !== null;
    cleanup();
    return shown;
}

afterEach(() => cleanup());

describe('Back button policy over the route registry', () => {
    it('names the five phone tabs the catalogue names, in the bottom bar', () => {
        expect([...TAB_BAR_DESTINATIONS].sort()).toEqual([...PHONE_TABS].sort());
    });

    it('covers every routed screen', () => {
        expect(routeIds.length).toBeGreaterThan(40);
        for (const id of PHONE_TABS) expect(ROUTE_REGISTRY[id], id).toBeDefined();
    });

    for (const surface of ['tabBar', 'sidebar', null]) {
        it(`shows Back exactly where the history does with surface ${surface ?? 'none'}`, () => {
            const wrong = [];
            for (const id of routeIds) {
                for (const canGoBack of [false, true]) {
                    for (const nested of [false, true]) {
                        const expected = rulingShowsBack(canGoBack, nested);
                        if (showsBack(surface, id, canGoBack, nested) !== expected) {
                            wrong.push(`${id}${canGoBack ? ' (pushed)' : ' (root)'}${nested ? ' (nested)' : ''}: Back ${expected ? 'missing' : 'shown'}`);
                        }
                    }
                }
            }
            expect(wrong).toEqual([]);
        });
    }

    it('documents the stack rule in STYLE_GUIDE.md', () => {
        const guide = readFileSync('STYLE_GUIDE.md', 'utf8');
        const rule = guide.split('\n').find((line) => line.startsWith('**When Back shows**')) || '';
        expect(rule).toMatch(/opened from another page/);
        expect(rule).toMatch(/root page/);
        expect(rule).not.toMatch(/NAV_SURFACE_DESTINATIONS/);
    });
});

// A header whose Back steps inside its own page (a review step, a picker, an
// open session) would lose its chevron on a root page unless it is marked
// nested. Every PageHeader whose onBack switches on a stage or step carries
// `nested`, so a form opened from the menu keeps Back on its review step.
describe('in-page steps keep Back on a root page', () => {
    const files = execFileSync('git', ['grep', '-l', '<PageHeader', '--', 'packages/core/src/shared'], { encoding: 'utf8' })
        .trim().split('\n').filter(Boolean);

    function headers(src) {
        const found = [];
        let i = 0;
        while ((i = src.indexOf('<PageHeader', i)) !== -1) {
            let depth = 0;
            let j = i;
            for (; j < src.length; j += 1) {
                const c = src[j];
                if (c === '{') depth += 1;
                else if (c === '}') depth -= 1;
                else if (c === '>' && depth === 0) break;
            }
            found.push({ tag: src.slice(i, j + 1), line: src.slice(0, i).split('\n').length });
            i = j;
        }
        return found;
    }

    function onBackOf(tag) {
        const at = tag.indexOf('onBack={');
        if (at === -1) return null;
        let depth = 1;
        let k = at + 'onBack={'.length;
        const start = k;
        for (; k < tag.length && depth > 0; k += 1) {
            if (tag[k] === '{') depth += 1;
            else if (tag[k] === '}') depth -= 1;
        }
        return tag.slice(start, k - 1);
    }

    it('marks every stage- or step-switched Back as nested', () => {
        const missing = [];
        for (const file of files) {
            for (const { tag, line } of headers(readFileSync(file, 'utf8'))) {
                const onBack = onBackOf(tag);
                if (!onBack || !/\b(stage|step|activeId|showPlace|showCast)\b[^?]*\?/.test(onBack)) continue;
                if (!/\bnested\b/.test(tag)) missing.push(`${file}:${line}`);
            }
        }
        expect(missing).toEqual([]);
    });
});
