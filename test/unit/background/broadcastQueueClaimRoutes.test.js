// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell keeps the vault lease across a route only when the route type
// matches its claim pattern. A route that hands its flow the queue-on-failure
// hook but is missing from the pattern lets the lease release, and the queue
// store go dormant, while its broadcast is still running.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { __queueWritingRouteForTests } from '../../../packages/web/src/hostBridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const HOST_SOURCE = readFileSync(
    join(here, '../../../packages/extension/src/background/createBackgroundHost.js'),
    'utf8',
);

// Registration calls, plus the helper that wraps the hardware ones, split the
// file into one text span per route.
const BOUNDARY = /(host\.register|registerHwHandler)\(\s*'([^']+)'|function registerHwHandler\(/g;

function hookCarryingRoutes(source) {
    const marks = [...source.matchAll(BOUNDARY)];
    const routes = new Set();
    marks.forEach((mark, i) => {
        if (!mark[2]) return;
        const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
        const isHardware = mark[1] === 'registerHwHandler';
        if (isHardware || source.slice(mark.index, end).includes('enqueueOnBroadcastFailure(')) {
            routes.add(mark[2]);
        }
    });
    return routes;
}

describe('web lease claim covers every hook-carrying route', () => {
    it('finds the hardware handshake among the hook-carrying routes', () => {
        const routes = hookCarryingRoutes(HOST_SOURCE);
        expect(routes.has('messaging.handshake.hw')).toBe(true);
        expect(routes.has('messaging.handshake')).toBe(true);
        expect(routes.has('action.send.hw')).toBe(true);
        expect(routes.has('wallet.publishLabels')).toBe(true);
    });

    it('matches every hook-carrying route type', () => {
        const unclaimed = [...hookCarryingRoutes(HOST_SOURCE)]
            .filter((type) => !__queueWritingRouteForTests.test(type));
        expect(unclaimed).toEqual([]);
    });

    it('claims the hardware handshake and still leaves read routes unclaimed', () => {
        expect(__queueWritingRouteForTests.test('messaging.handshake.hw')).toBe(true);
        expect(__queueWritingRouteForTests.test('messaging.inbox')).toBe(false);
        expect(__queueWritingRouteForTests.test('messaging.handshake.hwx')).toBe(false);
    });
});
