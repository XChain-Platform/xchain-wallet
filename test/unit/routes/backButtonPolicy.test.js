// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Back button policy over the whole route registry (UI ruling U17).
// On phones the bottom tab bar is the way out of Home, History, Send and
// Scan, so those four hide Back and every other screen shows it; with the
// sidebar on screen every route the sidebar links to hides it. A sub-screen
// that shares its parent's route id always shows Back, and outside the
// unlocked layout Back always shows. The rule is written out here from the
// ruling, independent of NAV_SURFACE_DESTINATIONS, and every registered
// route is rendered under each surface against it.

import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';
import {
    CurrentRouteContext,
    NavSurfaceContext,
} from '../../../packages/core/src/shared/components/navSurface.js';
import { ROUTE_REGISTRY, TAB_BAR_DESTINATIONS } from '../../../packages/core/src/shared/routeRegistry.js';

/** The four bottom-bar tabs the ruling names. */
const PHONE_TABS = ['home', 'history', 'send', 'scan'];

/** Every route the sidebar and icon rail link to directly. */
const SIDEBAR_ROUTES = [
    'home', 'history', 'send', 'receive', 'scan', 'markets', 'market-activity', 'dispensers-list',
    'contracts-list', 'messaging', 'contacts', 'lists', 'obligations', 'settings',
];

/** Whether the ruling shows Back on `routeId` under `surface`. */
function rulingShowsBack(routeId, surface, nested) {
    if (nested) return true;
    if (surface === 'tabBar') return !PHONE_TABS.includes(routeId);
    if (surface === 'sidebar') return !SIDEBAR_ROUTES.includes(routeId);
    return true;
}

const BACK = { name: 'Back to previous screen' };
const routeIds = Object.keys(ROUTE_REGISTRY);

function showsBack(surface, routeId, nested) {
    render(h(
        NavSurfaceContext.Provider,
        { value: surface },
        h(CurrentRouteContext.Provider, { value: routeId }, h(PageHeader, { title: 'Screen', onBack: () => {}, nested })),
    ));
    const shown = screen.queryByRole('button', BACK) !== null;
    cleanup();
    return shown;
}

afterEach(() => cleanup());

describe('Back button policy over the route registry', () => {
    it('names the four phone tabs the ruling names, in the bottom bar', () => {
        expect([...TAB_BAR_DESTINATIONS].sort()).toEqual([...PHONE_TABS].sort());
    });

    it('covers every routed screen', () => {
        expect(routeIds.length).toBeGreaterThan(40);
        for (const id of [...PHONE_TABS, ...SIDEBAR_ROUTES]) expect(ROUTE_REGISTRY[id], id).toBeDefined();
    });

    for (const surface of ['tabBar', 'sidebar', null]) {
        it(`shows Back exactly where the ruling does with surface ${surface ?? 'none'}`, () => {
            const wrong = [];
            for (const id of routeIds) {
                for (const nested of [false, true]) {
                    const expected = rulingShowsBack(id, surface, nested);
                    if (showsBack(surface, id, nested) !== expected) {
                        wrong.push(`${id}${nested ? ' (nested)' : ''}: Back ${expected ? 'missing' : 'shown'}`);
                    }
                }
            }
            expect(wrong).toEqual([]);
        });
    }

    it('documents the phone tabs in STYLE_GUIDE.md', () => {
        const guide = readFileSync('STYLE_GUIDE.md', 'utf8');
        const rule = guide.split('\n').find((line) => line.startsWith('**When Back shows**')) || '';
        expect(rule).toMatch(/with the bottom tab bar it is Home, History, Send and Scan\./);
    });
});
