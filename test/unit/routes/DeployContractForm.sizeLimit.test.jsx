// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A contract's constructor arguments are the repeating tail of its DEPLOY v0
// (inline) or v2 (assembling) action. Past 8192 compiled bytes that action
// rides a Taproot envelope the wallet cannot verify, and for a chunked source
// every chunk before it is already paid for. The form refuses before compose,
// naming the limit, how many arguments fit and how many were given.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, act as domAct, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'module.exports = { meta: { name: "T", description: "d" }, run() { return 1; } };';
const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const args = (n) => Array.from({ length: n }, (_, i) => String(i).padStart(44, 'x'));

function mount({ single }) {
    const composeForConfirm = vi.fn().mockResolvedValue(null);
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve(single
            ? { single: true, totalChunks: 0, codeHash: 'ab' }
            : { single: false, totalChunks: 3, codeHash: 'ab' }),
        getContractExportedMeta: () => Promise.resolve(null),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            return property in object ? object[property] : () => Promise.resolve({});
        },
    });
    return { messaging, composeForConfirm };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function fillAndPublish({ messaging, source, constructorParams }) {
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DeployContractForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: source } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.change(utils.getByLabelText('Constructor params (optional)'), { target: { value: constructorParams } });
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Publish' }));
        await drain();
    });
    return utils;
}

afterEach(() => cleanup());

describe('DeployContractForm refuses constructor arguments too large to verify, before compose', () => {
    it('refuses an inline deploy whose arguments push it past 8192 bytes', async () => {
        const { messaging, composeForConfirm } = mount({ single: false });
        const utils = await fillAndPublish({ messaging, source: SOURCE, constructorParams: args(300).join('|') });

        expect(utils.container.textContent).toMatch(
            /This deploy has 300 arguments \(13,\d{3} bytes\), but one action holds 8,192 bytes, which fits 1[78]\d of them\. Remove 1[12]\d arguments\./,
        );
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a chunked source whose assembling action cannot be verified', async () => {
        const { messaging, composeForConfirm } = mount({ single: false });
        const bigSource = `${SOURCE}\n// ${'z'.repeat(9000)}`;
        const utils = await fillAndPublish({ messaging, source: bigSource, constructorParams: args(300).join('|') });

        expect(utils.container.textContent).toMatch(/This deploy has 300 arguments/);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('lets a chunked source with no arguments through to review', async () => {
        const { messaging } = mount({ single: false });
        const bigSource = `${SOURCE}\n// ${'z'.repeat(9000)}`;
        const utils = await fillAndPublish({ messaging, source: bigSource, constructorParams: '' });

        expect(utils.container.textContent).not.toMatch(/one action holds/);
    });
});
