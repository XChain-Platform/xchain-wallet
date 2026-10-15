/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    QUIT_DEFERRING_MESSAGE_TYPES,
    QUIT_DEFER_DEADLINE_MS,
    createQuitDeferral,
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

describe('desktop quit deferral clock', () => {
    function harness({ busy = true } = {}) {
        const state = { busy, timers: [], cleared: [] };
        const quit = vi.fn();
        const deferral = createQuitDeferral({
            isBusy: () => state.busy,
            quit,
            deadlineMs: 1000,
            setTimer: (fn, ms) => {
                const handle = { fn, ms };
                state.timers.push(handle);
                return handle;
            },
            clearTimer: (handle) => { state.cleared.push(handle); },
        });
        return { state, quit, deferral };
    }

    it('lets quit through at once when nothing counted is in flight', () => {
        const { state, quit, deferral } = harness({ busy: false });
        expect(deferral.request()).toBeNull();
        expect(state.timers).toHaveLength(0);
        expect(quit).not.toHaveBeenCalled();
    });

    it('defers the first quit, then quits once the work settles', () => {
        const { state, quit, deferral } = harness();
        expect(deferral.request()).toBe('defer');
        expect(state.timers).toHaveLength(1);
        deferral.settle();
        expect(quit).not.toHaveBeenCalled();
        state.busy = false;
        deferral.settle();
        expect(quit).toHaveBeenCalledOnce();
        expect(state.cleared).toEqual([state.timers[0]]);
        state.busy = true;
        expect(deferral.request()).toBeNull();
    });

    it('holds later quits on the same clock and quits at the deadline while work is stuck', () => {
        const { state, quit, deferral } = harness();
        expect(deferral.request()).toBe('defer');
        expect(deferral.request()).toBe('wait');
        expect(state.timers).toHaveLength(1);
        expect(state.timers[0].ms).toBe(1000);
        state.timers[0].fn();
        expect(quit).toHaveBeenCalledOnce();
        expect(deferral.request()).toBeNull();
        deferral.settle();
        state.timers[0].fn();
        expect(quit).toHaveBeenCalledOnce();
    });

    it('ignores settles when no quit is waiting', () => {
        const { quit, deferral } = harness({ busy: false });
        deferral.settle();
        expect(quit).not.toHaveBeenCalled();
    });

    it('waits fifteen seconds by default', () => {
        expect(QUIT_DEFER_DEADLINE_MS).toBe(15_000);
    });
});
