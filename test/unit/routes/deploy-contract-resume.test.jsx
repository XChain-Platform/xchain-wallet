// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it } from 'vitest';
import { render, act as domAct, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = "module.exports = { meta: { name: 'Big', description: 'd', version: '1' } };";
const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function pendingRecord(overrides = {}) {
    return {
        id: 'run-1',
        chainId: CHAIN,
        stage: 'chunking',
        name: 'Big',
        code: SOURCE,
        totalChunks: 2,
        chunks: [{ index: 0, txid: 't0', actionIndex: '900' }, { index: 1, txid: null, actionIndex: null }],
        assembleParams: {
            VERSION: '2', CODE_HASH: 'ab', GAS_LIMIT: '200000', CONSTRUCTOR_PARAMS: ['alpha', 'beta'],
        },
        ...overrides,
    };
}

function mount(records, overrides = {}) {
    const fallback = () => Promise.resolve({});
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve(records),
        planDeploy: () => Promise.resolve({ single: false, totalChunks: 2, codeHash: 'ab' }),
        getContractExportedMeta: () => Promise.resolve(null),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            return property in object ? object[property] : fallback;
        },
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DeployContractForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
}

async function drain(rounds = 24) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

afterEach(() => cleanup());

describe('DeployContractForm resuming an unfinished publish', () => {
    async function resumed(records = [pendingRecord()]) {
        let utils;
        await domAct(async () => { utils = mount(records); await drain(); });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Resume publishing' }));
            await drain();
        });
        return utils;
    }

    it('shows the run\'s own gas and constructor arguments and fixes them', async () => {
        const utils = await resumed();

        const gas = utils.getByLabelText('Gas limit');
        const constructor = utils.getByLabelText('Constructor params (optional)');
        expect(gas).toHaveValue('200000');
        expect(constructor).toHaveValue('alpha|beta');
        // The flow assembles from the record, so an edit here would change the
        // review and not the transaction.
        for (const field of [gas, constructor, utils.getByLabelText('Cooldown blocks (optional)'), utils.getByLabelText('Slash destination (optional)')]) {
            expect(field).toBeDisabled();
        }
    });

    it('blanks a field the run does not carry instead of keeping what was typed before Resume', async () => {
        let utils;
        await domAct(async () => {
            utils = mount([pendingRecord({ assembleParams: { VERSION: '2', CODE_HASH: 'ab', GAS_LIMIT: '200000' } })]);
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Constructor params (optional)'), { target: { value: 'typed' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Resume publishing' }));
            await drain();
        });

        expect(utils.getByLabelText('Constructor params (optional)')).toHaveValue('');
    });

    it('leaves the fields editable for a run with no stored plan', async () => {
        const utils = await resumed([pendingRecord({ assembleParams: undefined })]);

        expect(utils.getByLabelText('Gas limit')).not.toBeDisabled();
        expect(utils.getByLabelText('Constructor params (optional)')).not.toBeDisabled();
    });

    it('unlocks the fields once the run is discarded', async () => {
        let utils;
        await domAct(async () => {
            utils = mount([pendingRecord()], { clearPendingDeploy: () => Promise.resolve({}) });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Resume publishing' }));
            await drain();
        });
        expect(utils.getByLabelText('Gas limit')).toBeDisabled();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Discard' }));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(within(utils.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
            await drain();
        });

        expect(utils.getByLabelText('Gas limit')).not.toBeDisabled();
    });
});

describe('DeployContractForm discarding an unfinished publish', () => {
    it('asks before forgetting chunks that are already paid for', async () => {
        const cleared = [];
        let utils;
        await domAct(async () => {
            utils = mount([pendingRecord()], { clearPendingDeploy: (req) => { cleared.push(req.id); return Promise.resolve({}); } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Discard' }));
            await drain();
        });

        const dialog = utils.getByRole('dialog');
        expect(dialog).toHaveTextContent('1 of 2 chunk transactions are already sent and paid for');
        expect(cleared).toEqual([]);

        await domAct(async () => {
            fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
            await drain();
        });
        expect(cleared).toEqual([]);
        expect(utils.getByRole('button', { name: 'Resume publishing' })).toBeInTheDocument();

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Discard' }));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(within(utils.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
            await drain();
        });
        expect(cleared).toEqual(['run-1']);
        expect(utils.queryByRole('button', { name: 'Resume publishing' })).toBeNull();
    });

    it('discards at once when no chunk has been sent', async () => {
        const cleared = [];
        let utils;
        await domAct(async () => {
            utils = mount(
                [pendingRecord({ chunks: [{ index: 0, txid: null, actionIndex: null }, { index: 1, txid: null, actionIndex: null }] })],
                { clearPendingDeploy: (req) => { cleared.push(req.id); return Promise.resolve({}); } },
            );
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Discard' }));
            await drain();
        });

        expect(utils.queryByRole('dialog')).toBeNull();
        expect(cleared).toEqual(['run-1']);
    });
});

describe('DeployContractForm review of a chunked publish', () => {
    async function review(plan) {
        let utils;
        await domAct(async () => {
            utils = mount([], { planDeploy: () => Promise.resolve(plan) });
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '200000' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Publish' }));
            await drain();
        });
        return utils;
    }

    it('says the network fee is paid for every transaction of the run', async () => {
        const utils = await review({ single: false, totalChunks: 2, codeHash: 'ab' });

        expect(utils.getByRole('heading', { name: 'Review publish' })).toBeInTheDocument();
        expect(utils.getByText('Network fee').nextSibling).toHaveTextContent(/ for each of 3 transactions$/);
    });
});
