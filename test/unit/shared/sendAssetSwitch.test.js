// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Send's Change asset step: the send-picker returns to Send, never Home, and
// Send's own Back target survives the round trip.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    applySendAssetPick,
    beginSendAssetSwitch,
    cancelSendAssetSwitch,
} from '../../../packages/core/src/shared/utils/sendAssetSwitch.js';

const DRAFT = {
    chainId: 'bitcoin-regtest',
    tick: 'XCP',
    address: 'bcrt1qrecipient',
    amount: '1.5',
    feeSelection: { mode: 'fast' },
};

const SHELLS = [
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
    'packages/extension/src/popup/App.jsx',
];

function block(src, start, end) {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a + start.length);
    expect(a, start).toBeGreaterThanOrEqual(0);
    return src.slice(a, b);
}

describe('send asset switch', () => {
    it('restores the draft when the picker is backed out of', () => {
        const opened = { chainId: 'bitcoin-regtest', tick: 'XCP', displayName: 'Counterparty', memo: 'rent' };
        const during = beginSendAssetSwitch(opened, DRAFT);
        expect(during.assetSwitchDraft).toEqual(DRAFT);
        expect(cancelSendAssetSwitch(during)).toEqual({
            chainId: 'bitcoin-regtest',
            tick: 'XCP',
            displayName: 'Counterparty',
            memo: 'rent',
            address: 'bcrt1qrecipient',
            amount: '1.5',
            feeSelection: { mode: 'fast' },
        });
    });

    it('drops a stale notice and survives a Send opened without prefill', () => {
        const during = beginSendAssetSwitch({ assetSwitchNotice: 'Token changed.' }, { ...DRAFT, amount: '' });
        expect(during.assetSwitchNotice).toBeUndefined();
        const restored = cancelSendAssetSwitch(during);
        expect(restored.amount).toBeFalsy();
        expect(restored.assetSwitchDraft).toBeUndefined();
        expect(cancelSendAssetSwitch(null)).toBeNull();
    });

    it('keeps recipient, amount and fee for the same token', () => {
        const next = applySendAssetPick(beginSendAssetSwitch(null, DRAFT), { chainId: 'bitcoin-regtest', tick: 'xcp' });
        expect(next).toMatchObject({ address: 'bcrt1qrecipient', amount: '1.5', feeSelection: { mode: 'fast' } });
        expect(next.assetSwitchNotice).toBeUndefined();
    });

    it('resets the amount for another token and everything for another chain', () => {
        const during = beginSendAssetSwitch(null, DRAFT);
        const token = applySendAssetPick(during, { chainId: 'bitcoin-regtest', tick: 'PEPE' });
        expect(token).toMatchObject({ address: 'bcrt1qrecipient', amount: undefined });
        expect(token.assetSwitchNotice).toMatch(/^Token changed/);
        const chain = applySendAssetPick(during, { chainId: 'litecoin-regtest', tick: 'LTC' });
        expect(chain).toMatchObject({ address: undefined, amount: undefined, feeSelection: undefined });
        expect(chain.assetSwitchNotice).toMatch(/^Network changed/);
    });

    it('names no reset when the switch drops nothing the form held', () => {
        const empty = { chainId: 'bitcoin-regtest', tick: 'BTC', address: '', amount: '', feeSelection: { mode: 'normal' } };
        const during = beginSendAssetSwitch(null, empty);
        expect(applySendAssetPick(during, { chainId: 'bitcoin-regtest', tick: 'XCP' }).assetSwitchNotice).toBeUndefined();
        expect(applySendAssetPick(during, { chainId: 'litecoin-regtest', tick: 'LTC' }).assetSwitchNotice).toBeUndefined();
        // A recipient alone is still dropped by a network change, and only that change.
        const withRecipient = beginSendAssetSwitch(null, { ...empty, address: 'bcrt1qrecipient' });
        expect(applySendAssetPick(withRecipient, { chainId: 'bitcoin-regtest', tick: 'XCP' }).assetSwitchNotice).toBeUndefined();
        expect(applySendAssetPick(withRecipient, { chainId: 'litecoin-regtest', tick: 'LTC' }).assetSwitchNotice).toMatch(/^Network changed/);
        const withFee = beginSendAssetSwitch(null, { ...empty, feeSelection: { mode: 'custom', customRate: 12 } });
        expect(applySendAssetPick(withFee, { chainId: 'litecoin-regtest', tick: 'LTC' }).assetSwitchNotice).toMatch(/^Network changed/);
    });

    it.each(SHELLS)('%s backs out of send-picker to Send and leaves Send\'s back target alone', (path) => {
        const src = readFileSync(path, 'utf8');
        const picker = block(src, "unlockedView === 'send-picker'", "unlockedView === 'receive-picker'");
        expect(picker).toMatch(/onBack=\{\(\) => \{\s*setSendPrefill\(cancelSendAssetSwitch\);\s*setUnlockedView\('send'\);/);
        expect(picker).not.toMatch(/setUnlockedView\('home'\)/);
        expect(picker).not.toMatch(/setSendBackTo\(/);
        expect(src).toMatch(/setSendPrefill\(\(prev\) => beginSendAssetSwitch\(prev, carry\)\)/);
    });

    it.each(SHELLS)('%s backs out of receive-picker to Receive', (path) => {
        const src = readFileSync(path, 'utf8');
        const picker = block(src, "unlockedView === 'receive-picker'", "unlockedView === 'receive'");
        expect(picker).toMatch(/onBack=\{\(\) => setUnlockedView\('receive'\)\}/);
    });
});
