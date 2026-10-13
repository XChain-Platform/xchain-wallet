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
    redactDiagnosticText,
    sanitizeDiagnosticValue,
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

describe('diagnostic dump privacy boundary', () => {
    it('reports the shell platform and whitelists build metadata', async () => {
        const dump = await diagnosticDump({
            env: { shell: 'desktop', platform: 'darwin arm64', userAgent: 'Electron/44' },
            build: { gitCommit: 'abcdef123456', target: '0.341.2', password: 'build-secret' },
        });

        expect(dump.wallet).toEqual({
            version: null,
            platform: 'desktop',
            os: 'darwin arm64',
            browser: 'Electron/44',
        });
        expect(dump.build).toEqual({ gitCommit: 'abcdef123456', target: '0.341.2' });
    });

    it('redacts addresses, balances, keys, phrases, and passwords from errors and logs', async () => {
        const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
        const wif = 'L1aW4aubDFB7yfras2S1mN3bqg9w7Z5e7U7J9T5h8V7Q5M2L1K9A';
        const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
        const legacyPhrase = 'like just love know never want time out there make look eye';
        const sensitive = `${address} has balance 1.25 BTC; password="hunter2"; WIF=${wif}; ${phrase}; ${legacyPhrase}`;
        const dump = await diagnosticDump({
            recentErrors: [{ at: '2026-01-01', kind: 'Error', message: sensitive }],
            recentLogs: [{ id: 1, timestamp: 2, level: 'error', source: 'wallet', message: sensitive }],
        });
        const report = JSON.stringify(dump);

        for (const secret of [address, '1.25 BTC', 'hunter2', wif, phrase, legacyPhrase]) {
            expect(report).not.toContain(secret);
        }
        expect(dump.recent_errors[0].message).toMatch(/^redacted:sha256:[0-9a-f]{8}$/);
        expect(dump.recent_logs[0].message).toMatch(/^redacted:sha256:[0-9a-f]{8}$/);
    });

    it('redacts sensitive fields from a serialized report returned by an older host', () => {
        const text = JSON.stringify(sanitizeDiagnosticValue({
            password: 'correct horse battery staple',
            address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
            nested: { privateKey: 'a'.repeat(64), balance: 12.5 },
        }), null, 2);

        expect(() => JSON.parse(text)).not.toThrow();
        expect(text).not.toContain('correct horse battery staple');
        expect(text).not.toContain('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
        expect(text).not.toContain('a'.repeat(64));
        expect(text).not.toContain('12.5');
    });

    it('is idempotent when a report passes through both host and UI boundaries', () => {
        const once = redactDiagnosticText('password="hunter2"; balance=1.25 BTC');
        expect(redactDiagnosticText(once)).toBe(once);
    });
});
