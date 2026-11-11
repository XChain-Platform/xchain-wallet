// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatNativeFee: () => '~$0.98',
        formatProtocolFee: () => '~$0.13',
        formatFeeTotal: () => '~$1.11',
    }),
}));

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: 'bitcoin-mainnet',
                tick: /get/i.test(title) ? 'BETA' : 'ALPHA',
            })}
        >
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const RECEIVE = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const QUOTE = { xchainFee: '0.064', requiredFeeSats: 197 };
const BTC_ADDRESS = {
    id: 'btc-1',
    address: SOURCE,
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const LTC_ADDRESS = {
    ...BTC_ADDRESS,
    id: 'ltc-1',
    address: RECEIVE,
    derivationPath: "m/84'/2'/0'/0/0",
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function makeMessaging(overrides = {}, { quoteTransport = true } = {}) {
    const quoteProtocolFee = vi.fn().mockResolvedValue(QUOTE);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [BTC_ADDRESS],
            [LTC]: [LTC_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockResolvedValue(LTC_ADDRESS),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', fiatCurrency: 'USD' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [BTC]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'ALPHA', quantity: '10000000000', divisibility: 8 },
                        { tick: 'BETA', quantity: '10000000000', divisibility: 8 },
                    ],
                },
            }],
        }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8 }),
        listActions: vi.fn().mockResolvedValue(['BATCH', 'BROADCAST']),
        getActionFormats: vi.fn().mockResolvedValue({ 0: 'COMMAND' }),
        getActionFields: vi.fn().mockResolvedValue(['VERSION', 'COMMAND']),
        validateAction: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
        listContractTemplates: vi.fn().mockResolvedValue({ templates: [], patterns: [] }),
        listPendingDeploys: vi.fn().mockResolvedValue([]),
        planDeploy: vi.fn().mockResolvedValue({ single: true, totalChunks: 0, codeHash: 'ab' }),
        getContractExportedMeta: vi.fn().mockResolvedValue(null),
        getContractByActionIndex: vi.fn().mockResolvedValue({}),
        buildBatchCommand: vi.fn().mockResolvedValue({ command: 'BROADCAST|0|hello' }),
        ...(quoteTransport ? { quoteProtocolFee } : {}),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get(current, prop) {
            if (prop in current) return current[prop];
            if (prop === 'quoteProtocolFee' && !quoteTransport) return undefined;
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            current[prop] = stub;
            return stub;
        },
    });
    return { messaging, quoteProtocolFee };
}

function mount(Form, props, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Form walletId="wallet-1" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

async function expectLiveQuote(quoteProtocolFee, expected) {
    await waitFor(() => expect(quoteProtocolFee).toHaveBeenCalledWith(expected), { timeout: 2500 });
    expect(await screen.findByText('0.064 XCHAIN')).toBeInTheDocument();
    expect(screen.getByText(/\+ 0\.064 XCHAIN/)).toBeInTheDocument();
}

async function chooseToken(label, pickerTitle) {
    fireEvent.click(await screen.findByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: `Choose ${pickerTitle}` }));
}

describe('Fees card live quotes for contracts and swaps', () => {
    it('quotes the same-chain SWAP payload', async () => {
        const { messaging, quoteProtocolFee } = makeMessaging();
        mount(SwapForm, { initialChainId: BTC, initialGiveTick: 'ALPHA' }, messaging);

        await chooseToken(/Get token:/, 'Select get token');
        fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });

        await expectLiveQuote(quoteProtocolFee, {
            chainId: BTC,
            source: SOURCE,
            actionData: {
                action: 'SWAP',
                params: {
                    VERSION: '0',
                    GIVE_COIN: 'BTC',
                    GIVE_TICK: 'ALPHA',
                    GIVE_AMOUNT: '2',
                    GET_COIN: 'BTC',
                    GET_TICK: 'BETA',
                    GET_AMOUNT: '3',
                },
            },
        });
    });

    it('quotes the cross-chain SWAP on the give chain', async () => {
        const { messaging, quoteProtocolFee } = makeMessaging();
        mount(CrossChainSwapForm, {}, messaging);

        await chooseToken(/Give token:/, 'Select give token');
        await chooseToken(/Get token:/, 'Select get token');
        fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '4' } });
        fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Receive at'), { target: { value: RECEIVE } });

        await expectLiveQuote(quoteProtocolFee, {
            chainId: BTC,
            source: SOURCE,
            actionData: {
                action: 'SWAP',
                params: {
                    VERSION: '0',
                    GIVE_COIN: 'BTC',
                    GIVE_TICK: 'ALPHA',
                    GIVE_AMOUNT: '4',
                    GET_COIN: 'LTC',
                    GET_TICK: 'BETA',
                    GET_AMOUNT: '5',
                    GET_ADDRESS: RECEIVE,
                },
            },
        });
    });

    it('quotes the validated advanced action payload', async () => {
        const { messaging, quoteProtocolFee } = makeMessaging();
        mount(AdvancedActionsForm, {}, messaging);

        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), {
            target: { value: 'BATCH' },
        });
        fireEvent.change(await screen.findByLabelText('COMMAND'), {
            target: { value: 'BROADCAST|0|hello' },
        });

        await expectLiveQuote(quoteProtocolFee, {
            chainId: BTC,
            source: SOURCE,
            actionData: {
                action: 'BATCH',
                params: { COMMAND: 'BROADCAST|0|hello' },
            },
        });
    });

    it('quotes the canonical BATCH command shown at review', async () => {
        const { messaging, quoteProtocolFee } = makeMessaging({
            buildBatchCommand: vi.fn().mockResolvedValue({ command: 'BROADCAST|0|hello' }),
        });
        mount(BatchComposerForm, {}, messaging);

        fireEvent.change(await screen.findByRole('combobox', { name: 'Action' }), {
            target: { value: 'BROADCAST' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

        await expectLiveQuote(quoteProtocolFee, {
            chainId: BTC,
            source: SOURCE,
            actionData: {
                action: 'BATCH',
                params: { VERSION: '0', COMMAND: 'BROADCAST|0|hello' },
            },
        });
    });

    it('quotes the single-transaction DEPLOY payload', async () => {
        const { messaging, quoteProtocolFee } = makeMessaging();
        mount(DeployContractForm, {}, messaging);

        fireEvent.change(await screen.findByLabelText('Code source'), {
            target: { value: 'function main() { return 1; }' },
        });
        fireEvent.change(screen.getByLabelText('Gas limit'), { target: { value: '1000' } });

        await expectLiveQuote(quoteProtocolFee, {
            chainId: BTC,
            source: SOURCE,
            actionData: {
                action: 'DEPLOY',
                params: {
                    VERSION: '0',
                    CODE: 'function main() { return 1; }',
                    GAS_LIMIT: '1000',
                },
            },
        });
    });

    it('quotes the DEPOSIT plus EXECUTE wrapper the submit path composes', async () => {
        const command = 'DEPOSIT|0|9|ALPHA|10;EXECUTE|0|9|fundLoan';
        const buildBatchCommand = vi.fn().mockResolvedValue({ command });
        const { messaging, quoteProtocolFee } = makeMessaging({ buildBatchCommand });
        mount(ExecuteContractForm, {
            chainId: BTC,
            contractActionIndex: '9',
            initialMethod: 'fundLoan',
        }, messaging);

        await chooseToken(/^Deposit:/, 'Token to deposit');
        fireEvent.change(screen.getByLabelText(/^Deposit amount/), { target: { value: '10' } });

        await expectLiveQuote(quoteProtocolFee, {
            chainId: BTC,
            source: SOURCE,
            actionData: {
                action: 'BATCH',
                params: { VERSION: '0', COMMAND: command },
            },
        });
        expect(buildBatchCommand).toHaveBeenCalledWith({
            chainId: BTC,
            subActions: [
                {
                    action: 'DEPOSIT',
                    params: {
                        VERSION: '0',
                        CONTRACT_ACTION_INDEX: '9',
                        TICK: 'ALPHA',
                        QUANTITY: '10',
                    },
                },
                {
                    action: 'EXECUTE',
                    params: {
                        VERSION: '0',
                        CONTRACT_ACTION_INDEX: '9',
                        METHOD: 'fundLoan',
                    },
                },
            ],
        });
    });

    it('waits for required SWAP inputs and falls back when the transport is absent', async () => {
        const available = makeMessaging();
        mount(SwapForm, { initialChainId: BTC, initialGiveTick: 'ALPHA' }, available.messaging);
        await screen.findByRole('button', { name: /Get token:/ });
        await new Promise((resolve) => setTimeout(resolve, 550));
        expect(available.quoteProtocolFee).not.toHaveBeenCalled();

        cleanup();
        const unavailable = makeMessaging({}, { quoteTransport: false });
        mount(SwapForm, { initialChainId: BTC, initialGiveTick: 'ALPHA' }, unavailable.messaging);
        await chooseToken(/Get token:/, 'Select get token');
        fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });

        await waitFor(() => expect(screen.getAllByText('Priced at review')).toHaveLength(2));
    });
});
