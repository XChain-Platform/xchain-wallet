// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The publish form must check the value it sends. It validated a trimmed gas
// limit and sent the padded text, and it read the cooldown with Number(), which
// accepts "1e3", "1.0" and "0x10" as whole numbers, then sent the text as typed.

import { afterEach, describe, it, expect } from 'vitest';
import { render, act as domAct, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = [
    'module.exports = {',
    "  meta: { name: 'Review Contract', description: 'Exercises the publish review.', version: '1.0.0' },",
    '  run() { return 1; }',
    '};',
].join('\n');

const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function harness() {
    const composed = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve({ single: true, totalChunks: 0, codeHash: 'ab' }),
        getContractExportedMeta: () => Promise.resolve({ status: 'present', name: 'Review Contract', description: 'x', version: '1.0.0' }),
        validateContractCode: () => Promise.resolve({ valid: true }),
        composeForConfirm: (args) => {
            composed.push(args);
            return Promise.reject(new Error('stop after compose'));
        },
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            return property in object ? object[property] : () => Promise.resolve({});
        },
    });
    return { messaging, composed };
}

afterEach(() => cleanup());

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function openForm() {
    const { messaging, composed } = harness();
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
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        await drain();
    });
    return { utils, composed };
}

async function publish(utils, fields) {
    await domAct(async () => {
        for (const [label, value] of Object.entries(fields)) {
            fireEvent.change(utils.getByLabelText(label), { target: { value } });
        }
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Publish' }));
        await drain();
    });
}

describe('DeployContractForm composes the values it validated', () => {
    it('sends the gas limit without the spaces it was trimmed of', async () => {
        const { utils, composed } = await openForm();
        await publish(utils, { 'Gas limit': ' 250000 ' });
        expect(composed).toHaveLength(1);
        expect(composed[0].actionData.params.GAS_LIMIT).toBe('250000');
    });

    it.each(['1e3', '1.0', '0x10', '14 4'])('refuses the cooldown "%s" instead of sending it as typed', async (cooldown) => {
        const { utils, composed } = await openForm();
        await publish(utils, { 'Gas limit': '250000', 'Cooldown blocks (optional)': cooldown });
        expect(composed).toHaveLength(0);
        expect(utils.container.textContent).toContain('Cooldown blocks must be an integer between 1 and 100000.');
    });

    it('sends a padded cooldown as the whole number it names', async () => {
        const { utils, composed } = await openForm();
        await publish(utils, { 'Gas limit': '250000', 'Cooldown blocks (optional)': ' 0144 ' });
        expect(composed).toHaveLength(1);
        expect(composed[0].actionData.params.COOLDOWN_BLOCKS).toBe('144');
    });
});
