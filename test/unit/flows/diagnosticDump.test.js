// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Crash hook helpers behind the diagnostic dump's recent_errors.

import { describe, it, expect } from 'vitest';
import {
    diagnosticDump,
    createErrorRingBuffer,
    installShellErrorCapture,
} from '../../../packages/core/src/flows/diagnosticDump.js';

function fakeTarget() {
    const handlers = {};
    return {
        handlers,
        addEventListener: (t, fn) => { handlers[t] = fn; },
        removeEventListener: (t) => { delete handlers[t]; },
    };
}

describe('installShellErrorCapture', () => {
    it('records error and unhandledrejection events', () => {
        const buffer = createErrorRingBuffer();
        const target = fakeTarget();
        installShellErrorCapture(target, buffer);
        target.handlers.error({ error: new TypeError('boom') });
        target.handlers.unhandledrejection({ reason: 'nope' });
        const list = buffer.list();
        expect(list.map((e) => e.kind)).toEqual(['TypeError', 'Error']);
        expect(list.map((e) => e.phase)).toEqual(['error', 'unhandledrejection']);
    });

    it('uninstalls and tolerates targets without listeners', () => {
        const buffer = createErrorRingBuffer();
        const target = fakeTarget();
        installShellErrorCapture(target, buffer)();
        expect(target.handlers).toEqual({});
        expect(installShellErrorCapture({}, buffer)).toBeTypeOf('function');
    });

    it('hashes free-form error and log messages before they enter the dump', async () => {
        const buffer = createErrorRingBuffer();
        const address = 'bc1qexampleaddresswithwalletbalance000000000000000';
        const wif = 'L1ExamplePrivateKeyThatMustNeverLeaveTheWallet11111';
        const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
        const secretMessage = `${address} has 42 BTC; key=${wif}; phrase=${phrase}`;
        buffer.record(new Error(secretMessage));
        const [capturedError] = buffer.list();

        const dump = await diagnosticDump({
            recentErrors: [{ ...capturedError, at: secretMessage, kind: secretMessage, phase: secretMessage }],
            recentLogs: [{ id: 1, timestamp: 2, level: 'error', source: secretMessage, message: secretMessage }],
        });
        const serialized = JSON.stringify(dump);

        expect(dump.recent_errors[0].message).toMatch(/^redacted:sha256:[0-9a-f]{8}$/);
        expect(dump.recent_logs[0].message).toBe(dump.recent_errors[0].message);
        expect(dump.recent_errors[0].kind).toBe('Error');
        expect(dump.recent_errors[0].phase).toBeUndefined();
        expect(dump.recent_logs[0].source).toBe('other');
        expect(serialized).not.toContain(address);
        expect(serialized).not.toContain('42 BTC');
        expect(serialized).not.toContain(wif);
        expect(serialized).not.toContain(phrase);
    });
});
