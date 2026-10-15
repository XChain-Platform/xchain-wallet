/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    QUIT_DEFERRING_MESSAGE_TYPES,
    isQuitDeferringMessage,
} from '../../../packages/desktop/main/quitGuard.js';

const here = dirname(fileURLToPath(import.meta.url));
const hostSource = readFileSync(
    join(here, '..', '..', '..', 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);

/**
 * Every literal message type the background host registers, with its handler
 * body. Any `host.register(` call or function declaration ends the previous
 * body, so the generic hardware wrapper is not read as part of a neighbour.
 */
function hostHandlers() {
    const starts = [...hostSource.matchAll(/host\.register\(\s*(?:'([^']+)')?|\n\s*function /g)];
    return starts
        .map((match, i) => ({
            type: match[1],
            body: hostSource.slice(match.index, starts[i + 1]?.index ?? hostSource.length),
        }))
        .filter(({ type }) => typeof type === 'string');
}

describe('desktop quit deferral message set', () => {
    it('counts sends that sign and broadcast, software and hardware alike', () => {
        for (const type of ['action.send', 'action.send.hw', 'tx.replace', 'broadcast.signedTx']) {
            expect(isQuitDeferringMessage({ type })).toBe(true);
        }
    });

    it('never counts reads, previews, quotes or unsigned builders', () => {
        for (const type of [
            'balances.wallet',
            'history.address',
            'settings.get',
            'wallet.list',
            'wallet.unlock',
            'action.composeForConfirm',
            'action.quoteMaxSendable',
            'action.preflight',
            'action.send.psbt',
            'action.psbt',
            'auth.signMessage',
            'send.holdCancel',
        ]) {
            expect(isQuitDeferringMessage({ type })).toBe(false);
        }
        expect(isQuitDeferringMessage(null)).toBe(false);
        expect(isQuitDeferringMessage({ type: 42 })).toBe(false);
    });

    it('covers every hardware-signed action the host registers and its software twin', () => {
        const hwTypes = [...hostSource.matchAll(/registerHwHandler\('([^']+)'/g)].map((m) => m[1]);
        expect(hwTypes.length).toBeGreaterThan(10);
        for (const type of hwTypes) {
            expect(QUIT_DEFERRING_MESSAGE_TYPES, type).toContain(type);
            expect(QUIT_DEFERRING_MESSAGE_TYPES, type).toContain(type.replace(/\.hw$/, ''));
        }
    });

    it('covers every host handler that wires a broadcast-failure fallback', () => {
        const broadcasting = hostHandlers()
            .filter(({ body }) => body.includes('onBroadcastFailure'))
            .map(({ type }) => type);
        expect(broadcasting.length).toBeGreaterThan(10);
        for (const type of broadcasting) {
            expect(QUIT_DEFERRING_MESSAGE_TYPES, type).toContain(type);
        }
    });

    it('names only types the host actually registers', () => {
        const registered = new Set([
            ...hostHandlers().map(({ type }) => type),
            ...[...hostSource.matchAll(/registerHwHandler\('([^']+)'/g)].map((m) => m[1]),
        ]);
        for (const type of QUIT_DEFERRING_MESSAGE_TYPES) {
            expect(registered, type).toContain(type);
        }
    });
});
