// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function provider(messaging, child) {
    return <MessagingProvider shell="web" messaging={messaging}>{child}</MessagingProvider>;
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

afterEach(() => cleanup());

describe('contract route request isolation', () => {
    it('starts execution history at page one and clears ownership on a contract switch', async () => {
        const secondAddresses = deferred();
        const executions = vi.fn(({ contractActionIndex, opts }) => Promise.resolve({
            data: [{ action_index: `${contractActionIndex}-${opts.page}`, method: 'ping' }],
            total: 3,
        }));
        const messaging = {
            getContractByActionIndex: vi.fn(({ contractActionIndex }) => Promise.resolve({
                data: { action_index: contractActionIndex, source: ADDRESS.address },
            })),
            getActionByIndex: vi.fn().mockResolvedValue({ data: {} }),
            getContractState: vi.fn().mockResolvedValue({ state: {} }),
            getContractBalance: vi.fn().mockResolvedValue({ data: [] }),
            getExecutionsForContract: executions,
            getAddressesByChain: vi.fn()
                .mockResolvedValueOnce({ [CHAIN]: [ADDRESS] })
                .mockImplementationOnce(() => secondAddresses.promise),
        };
        const props = {
            walletId: 'wallet-1',
            chainId: CHAIN,
            contractActionIndex: '41',
            onBack() {},
        };
        const utils = render(provider(messaging, <ContractDetail {...props} />));

        await screen.findByText('ping #41-1');
        expect(screen.getByText(/Owner:/).parentElement).toHaveTextContent('(you)');
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        await waitFor(() => expect(executions).toHaveBeenCalledWith(expect.objectContaining({
            contractActionIndex: '41',
            opts: { page: 2 },
        })));

        utils.rerender(provider(messaging, <ContractDetail {...props} contractActionIndex="42" />));

        await screen.findByText('ping #42-1');
        expect(executions).toHaveBeenCalledWith(expect.objectContaining({
            contractActionIndex: '42',
            opts: { page: 1 },
        }));
        expect(screen.getByText(/Owner:/).parentElement).not.toHaveTextContent('(you)');
    });

    it('drops the previous contract ABI and its arguments when the next contract has none', async () => {
        const secondContract = deferred();
        const getContractByActionIndex = vi.fn(({ contractActionIndex }) => (
            contractActionIndex === '41'
                ? Promise.resolve({
                    data: {
                        abi: {
                            version: 1,
                            methods: {
                                configure: { params: [{ name: 'limit', type: 'number' }] },
                            },
                        },
                    },
                })
                : secondContract.promise
        ));
        const messaging = executeMessaging({ getContractByActionIndex });
        const props = {
            walletId: 'wallet-1',
            chainId: CHAIN,
            contractActionIndex: '41',
            onBack() {},
        };
        const utils = render(provider(messaging, <ExecuteContractForm {...props} />));

        const limit = await screen.findByLabelText('limit (number)');
        fireEvent.change(limit, { target: { value: '7' } });
        utils.rerender(provider(messaging, <ExecuteContractForm {...props} contractActionIndex="42" />));
        secondContract.resolve({ data: {} });
        await flush();

        expect(screen.queryByLabelText('limit (number)')).toBeNull();
        expect(screen.getByLabelText('Method')).toHaveValue('');
        expect(screen.getByLabelText('Params (optional)')).toHaveValue('');
    });

    it('clears positional values whenever a different declared method is selected', async () => {
        const messaging = executeMessaging({
            getContractByActionIndex: () => Promise.resolve({
                data: {
                    abi: {
                        version: 1,
                        methods: {
                            first: { params: [{ name: 'firstValue', type: 'string' }] },
                            second: { params: [{ name: 'secondValue', type: 'string' }] },
                        },
                    },
                },
            }),
        });
        render(provider(messaging, (
            <ExecuteContractForm
                walletId="wallet-1"
                chainId={CHAIN}
                contractActionIndex="41"
                onBack={() => {}}
            />
        )));

        fireEvent.change(await screen.findByLabelText('firstValue (string)'), { target: { value: 'secret-one' } });
        fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'second' } });
        expect(screen.getByLabelText('secondValue (string)')).toHaveValue('');
        fireEvent.change(screen.getByLabelText('secondValue (string)'), { target: { value: 'secret-two' } });
        fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'first' } });
        expect(screen.getByLabelText('firstValue (string)')).toHaveValue('');
    });
});

describe('contract list failure containment', () => {
    it('renders section errors when host methods throw before returning promises', async () => {
        const throws = () => { throw new Error('host disconnected'); };
        render(provider({
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
            getContractsForSource: throws,
            getDepositsForAddress: throws,
            getWithdrawalsForAddress: throws,
            getContractsBrowseAll: throws,
        }, (
            <ContractsList
                walletId="wallet-1"
                onOpenContract={() => {}}
                onBack={() => {}}
            />
        )));

        await waitFor(() => {
            expect(screen.getAllByText(/Couldn't load contracts on Bitcoin/)).toHaveLength(3);
        });
    });

    it('turns aggregation failures into section errors instead of rejected effect promises', async () => {
        render(provider({
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
            getContractsForSource: () => Promise.resolve({ data: [null] }),
            getDepositsForAddress: () => Promise.resolve({ data: [] }),
            getWithdrawalsForAddress: () => Promise.resolve({ data: [] }),
            getContractsBrowseAll: () => Promise.resolve({ data: [] }),
        }, (
            <ContractsList
                walletId="wallet-1"
                onOpenContract={() => {}}
                onBack={() => {}}
            />
        )));

        expect(await screen.findByText(/Couldn't load contracts on Bitcoin/)).toBeInTheDocument();
    });
});

describe('contract form submit locks', () => {
    it('dispatches one execute build for two submits in the same turn', async () => {
        const gate = deferred();
        const buildActionPsbtRequest = vi.fn(() => gate.promise);
        const messaging = executeMessaging({ buildActionPsbtRequest });
        render(provider(messaging, (
            <ExecuteContractForm
                walletId="wallet-1"
                chainId={CHAIN}
                contractActionIndex="41"
                onBack={() => {}}
            />
        )));

        fireEvent.change(await screen.findByLabelText('Method'), { target: { value: 'ping' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        const form = await screen.findByRole('form', { name: 'Review contract call' });
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });

    it('dispatches one deploy build for two submits in the same turn', async () => {
        const gate = deferred();
        const buildActionPsbtRequest = vi.fn(() => gate.promise);
        const messaging = deployMessaging({ buildActionPsbtRequest });
        render(provider(messaging, <DeployContractForm walletId="wallet-1" onBack={() => {}} />));

        fireEvent.change(await screen.findByLabelText('Code source'), {
            target: { value: 'module.exports = { run() { return 1; } };' },
        });
        fireEvent.change(screen.getByLabelText('Gas limit'), { target: { value: '50000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        const form = await screen.findByRole('form', { name: 'Review contract publication' });
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(buildActionPsbtRequest).toHaveBeenCalledTimes(1);
    });
});

function executeMessaging(overrides = {}) {
    return {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getContractByActionIndex: () => Promise.resolve({ data: {} }),
        ...overrides,
    };
}

function deployMessaging(overrides = {}) {
    return {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        signerReady: () => Promise.resolve({ ready: false }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve({ single: true, totalChunks: 0, codeHash: 'ab' }),
        getContractExportedMeta: () => Promise.resolve(null),
        ...overrides,
    };
}
