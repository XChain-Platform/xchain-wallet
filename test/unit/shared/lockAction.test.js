// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { lockImmediately } from '../../../packages/core/src/shared/utils/lockAction.js';

describe('lockImmediately', () => {
    it('clears transient action state and shows the lock screen before the host settles', async () => {
        const order = [];
        let settle;
        const hostLock = new Promise((resolve) => { settle = resolve; });
        const recover = vi.fn();

        const result = lockImmediately({
            clearTransientState: () => order.push('clear'),
            showLocked: () => order.push('locked'),
            lockWallet: () => {
                order.push('host');
                return hostLock;
            },
            recover,
        });

        expect(order).toEqual(['clear', 'locked', 'host']);
        expect(recover).not.toHaveBeenCalled();

        settle({ locked: true });
        await expect(result).resolves.toEqual({ locked: true });
        expect(recover).not.toHaveBeenCalled();
    });

    it('is the single lock path in every interactive shell and clears lifted action inputs', () => {
        const shellFiles = [
            'packages/web/src/App.jsx',
            'packages/desktop/renderer/App.jsx',
            'packages/extension/src/popup/App.jsx',
        ];
        const transientSetters = [
            'setTokenDetailRef(null)',
            'setSweepCtx(null)',
            'setResumeConfirmSession(null)',
            'setPrivateKeyAddress(null)',
            'setAddressPrefsTarget(null)',
            'setResumeCoinpay(null)',
            'setListForkRef(null)',
            'setSellNameRef(null)',
            'setComposePrefill(null)',
            'setStakingRef(null)',
            'setSendPrefill(null)',
            'setScannedPsbt(null)',
            'setExecutePrefill(null)',
            'setParallelPrefill(null)',
        ];

        for (const file of shellFiles) {
            const source = readFileSync(join(process.cwd(), file), 'utf8');
            const clearState = source.slice(
                source.indexOf('function clearTransientActionState()'),
                source.indexOf('function handleLock()'),
            );
            expect(source).toContain('function handleLock()');
            expect(source).toContain('lockImmediately({');
            expect(source).toContain("showLocked: () => setStatus({ state: 'locked' })");
            expect(source).toContain('lock: handleLock');
            expect(clearState).toContain("setUnlockedView('home')");
            for (const setter of transientSetters) expect(clearState).toContain(setter);
            expect(source).toMatch(
                /if \(status\.state !== 'unlocked'\) \{[\s\S]{0,400}?clearTransientActionState\(\)/,
            );
            expect(source).not.toMatch(/lockWallet\(\)\s*\.then\(refresh\)/);
        }

        const popupSource = readFileSync(
            join(process.cwd(), 'packages/extension/src/popup/App.jsx'),
            'utf8',
        );
        expect(popupSource).toMatch(
            /if \(status\.state !== 'unlocked'\) \{[\s\S]{0,400}?clearTransientActionState\(\)[\s\S]{0,160}?setWallets\(\[\]\)/,
        );
    });

    it('reconciles the real session when an asynchronous host lock fails', async () => {
        const recover = vi.fn(async () => undefined);

        await lockImmediately({
            clearTransientState: vi.fn(),
            showLocked: vi.fn(),
            lockWallet: async () => { throw new Error('host unavailable'); },
            recover,
        });

        expect(recover).toHaveBeenCalledTimes(1);
    });

    it('reconciles the real session when the host throws synchronously', async () => {
        const recover = vi.fn();

        await lockImmediately({
            clearTransientState: vi.fn(),
            showLocked: vi.fn(),
            lockWallet: () => { throw new Error('transport unavailable'); },
            recover,
        });

        expect(recover).toHaveBeenCalledTimes(1);
    });
});
