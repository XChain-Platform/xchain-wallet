// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shell crash hooks: a thrown error reaches the shell's ring buffer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installShellErrorCapture, getRecentShellErrors } from '../../../packages/web/src/errorCapture.js';
import { installShellErrorCapture as installDesktop } from '../../../packages/desktop/renderer/errorCapture.js';
import { installShellErrorCapture as installPopup } from '../../../packages/extension/src/popup/errorCapture.js';

describe('shell crash hook', () => {
    it('captures window error events', () => {
        const off = installShellErrorCapture();
        window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('bad range'), message: 'bad range' }));
        expect(getRecentShellErrors().some((e) => e.kind === 'RangeError')).toBe(true);
        off();
    });

    it('exposes the hook in desktop and popup shells', () => {
        expect(installDesktop()).toBeTypeOf('function');
        expect(installPopup()).toBeTypeOf('function');
    });
});

// Each shell's getDiagnosticDump must hand its ring buffer to the host, or
// the captured crashes never reach the dump.
const sent = vi.hoisted(() => ({ calls: [] }));
const record = (type, payload) => { sent.calls.push({ type, payload }); return Promise.resolve({}); };
vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage: record,
    getSessionStatus: () => Promise.resolve({}),
    unlockWalletLocal: () => {},
    lockWalletLocal: () => {},
    createWalletLocal: () => {},
    importMnemonicLocal: () => {},
    importBackupLocal: () => {},
}));
vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({ sendMessage: record }));
vi.mock('../../../packages/extension/src/shared/chromeMessaging.js', () => ({ sendMessage: record }));

describe('diagnostic dump request carries the shell buffer', () => {
    beforeEach(() => { sent.calls.length = 0; });

    const shells = [
        ['web', '../../../packages/web/src', '../../../packages/web/src/errorCapture.js'],
        ['desktop', '../../../packages/desktop/renderer', '../../../packages/desktop/renderer/errorCapture.js'],
        ['popup', '../../../packages/extension/src/popup', '../../../packages/extension/src/popup/errorCapture.js'],
    ];
    for (const [name, dir, cap] of shells) {
        it(`${name} sends recentErrors with diagnostic.dump`, async () => {
            const capture = await import(/* @vite-ignore */ cap);
            const messaging = await import(/* @vite-ignore */ `${dir}/messaging.js`);
            const off = capture.installShellErrorCapture();
            window.dispatchEvent(new ErrorEvent('error', { error: new TypeError(`boom-${name}`), message: `boom-${name}` }));
            await messaging.getDiagnosticDump();
            off();
            const call = sent.calls.find((c) => c.type === 'diagnostic.dump');
            expect(call.payload.recentErrors.some((e) => e.message === `boom-${name}`)).toBe(true);
        });
    }
});
