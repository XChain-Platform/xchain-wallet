// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { StakeNew } from '../../../packages/core/src/shared/routes/StakeNew.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const PUBKEY = 'a'.repeat(64);
const ADDRESS_ROW = {
    id: 'addr-1',
    address: ADDRESS,
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const ADDRESSES = { [CHAIN]: [ADDRESS_ROW] };

function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        if (depth === 0) return text.slice(open + 1, index);
    }
    return '';
}

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

function readCss(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

function messaging(overrides = {}) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getContractStakesForAddress: vi.fn().mockResolvedValue([]),
        getContractUnstakesForAddress: vi.fn().mockResolvedValue([]),
        getSlashEventsForAddress: vi.fn().mockResolvedValue([]),
        getContractByActionIndex: vi.fn().mockResolvedValue(null),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        ...overrides,
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function withMessaging(child, methods = messaging()) {
    return render(
        <MessagingProvider shell="web" messaging={methods}>
            {child}
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('staking chooser and list read states', () => {
    it('surfaces an address read failure instead of presenting an empty chooser', async () => {
        withMessaging(
            <StakeNew walletId="w" onPickValidator={() => {}} onPickContract={() => {}} onBack={() => {}} />,
            messaging({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address service unavailable')) }),
        );

        expect(await screen.findByRole('alert')).toHaveTextContent('Address service unavailable');
        expect(screen.queryByText(/generate an address first/i)).toBeNull();
    });

    it('does not call a complete read failure an empty staking wallet', async () => {
        withMessaging(
            <StakingList walletId="w" onOpenStake={() => {}} onNewStake={() => {}} onBack={() => {}} />,
            messaging({
                getStakesForAddress: vi.fn().mockRejectedValue(new Error('explorer unavailable')),
                getDelegationsForAddress: vi.fn().mockRejectedValue(new Error('explorer unavailable')),
                getRewardsForAddress: vi.fn().mockRejectedValue(new Error('explorer unavailable')),
            }),
        );

        expect(await screen.findByText(/Couldn't load some staking data/)).toBeInTheDocument();
        expect(screen.queryByText(/Nothing staked yet/)).toBeNull();
    });
});

describe('stake detail state', () => {
    it('labels a missing contract position inactive', async () => {
        withMessaging(
            <StakeDetail
                walletId="w"
                kind="contract"
                chainId={CHAIN}
                address={ADDRESS}
                contractActionIndex="12"
                onBack={() => {}}
            />,
        );

        expect(await screen.findByText('Nothing staked in this contract')).toBeInTheDocument();
        expect(screen.getByText('inactive')).toBeInTheDocument();
        expect(screen.getByText('Staking positions for this contract appear here.')).toBeInTheDocument();
    });

    it('resets the selected tab when the route changes staking kind', async () => {
        const methods = messaging();
        const props = { walletId: 'w', chainId: CHAIN, address: ADDRESS, onBack() {} };
        const view = withMessaging(<StakeDetail {...props} kind="validator" />, methods);
        await screen.findByRole('tab', { name: 'Details' });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');

        view.rerender(
            <MessagingProvider shell="web" messaging={methods}>
                <StakeDetail {...props} kind="contract" contractActionIndex="12" />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('tab', { name: 'Positions' })).toHaveAttribute('aria-selected', 'true');
    });
});

describe('stake amount and review state', () => {
    it('rejects more than the known XCHAIN balance and clears the error on edit', async () => {
        withMessaging(
            <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />,
            messaging({
                getWalletBalances: vi.fn().mockResolvedValue({
                    [CHAIN]: [{
                        address: ADDRESS,
                        balances: {
                            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                            tokens: [{ tick: 'XCHAIN', quantity: '500000000', divisibility: 8 }],
                        },
                    }],
                }),
            }),
        );

        await screen.findByText('5 XCHAIN available', {}, { timeout: 2000 });
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '6' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));
        expect(await screen.findByText('Amount exceeds the 5 XCHAIN available.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '4' } });
        expect(screen.queryByText(/Amount exceeds/)).toBeNull();
    });

    it('returns from watcher review to the populated stake form', async () => {
        const onBack = vi.fn();
        withMessaging(
            <StakeForm walletId="w" chainId={CHAIN} onBack={onBack} />,
            messaging({ getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }) }),
        );
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/Stake 1 XCHAIN for signing pubkey/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^Amount/)).toHaveValue('1');
        expect(screen.getByLabelText('Signing public key')).toHaveValue(PUBKEY);
    });
});

describe('staking action load and review state', () => {
    it('surfaces a failed available-balance read instead of loading forever', async () => {
        withMessaging(
            <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            messaging({ getRewardsForAddress: vi.fn().mockRejectedValue(new Error('explorer unavailable')) }),
        );

        expect(await screen.findByRole('alert')).toHaveTextContent(/available staking balance/i);
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.queryByText('Loading…')).toBeNull();
        expect(screen.getByRole('button', { name: 'Claim rewards' })).toBeDisabled();
    });

    it('returns from watcher review to the populated action form', async () => {
        const onBack = vi.fn();
        withMessaging(
            <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} onBack={onBack} />,
            messaging({
                getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
                getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]),
            }),
        );
        await screen.findByText('10 XCHAIN available');
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '4' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/Claim 4 XCHAIN/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^Amount/)).toHaveValue('4');
    });

    it('clears an amount validation error when the amount changes', async () => {
        withMessaging(
            <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            messaging({ getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]) }),
        );
        await screen.findByText('10 XCHAIN available');
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '11' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));
        expect(await screen.findByText('Amount exceeds the 10 XCHAIN available.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '5' } });
        await waitFor(() => expect(screen.queryByText(/Amount exceeds/)).toBeNull());
    });
});

describe.each([320, 360])('staking layout at %ipx', (width) => {
    it('stacks dense rows and keeps stake and unstake review actions reachable', async () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });

        try {
            withMessaging(
                <StakingList walletId="w" onOpenStake={() => {}} onNewStake={() => {}} onBack={() => {}} />,
                messaging({
                    getContractStakesForAddress: vi.fn().mockResolvedValue([{
                        target_contract_index: '12',
                        tick: 'LONGTOKEN',
                        signing_pubkey: PUBKEY,
                        amount: '123456789.12345678',
                        status: 'valid',
                        activation_block: 1,
                    }]),
                    getContractUnstakesForAddress: vi.fn().mockResolvedValue([{
                        target_contract_index: '12',
                        tick: 'LONGTOKEN',
                        signing_pubkey: PUBKEY,
                        amount: '1',
                        status: 'valid',
                        cooldown_end_block: 130,
                    }]),
                }),
            );

            const duration = await screen.findByText(/Releasing: 30 blocks to go/);
            expect(duration.className).toMatch(/duration/);
            expect(duration.parentElement?.className).toMatch(/trailing/);
            expect(screen.getAllByText('123,456,789.12345678 LONGTOKEN')
                .some((node) => /amount/.test(node.className))).toBe(true);

            cleanup();
            withMessaging(
                <StakeDetail
                    walletId="w"
                    kind="validator"
                    chainId={CHAIN}
                    address={ADDRESS}
                    onBack={() => {}}
                />,
                messaging({
                    getStakesForAddress: vi.fn().mockResolvedValue([{
                        amount: '10',
                        status: 'valid',
                        signing_pubkey: PUBKEY,
                    }]),
                    getRewardsForAddress: vi.fn().mockResolvedValue([{
                        amount: '987654321.12345678',
                        status: 'accrued reward with a long readable description',
                        block_index: 98,
                    }]),
                }),
            );

            const rewardWhen = await screen.findByText('block 98');
            expect(rewardWhen.closest('div')?.className).toMatch(/eventRow/);
            expect(rewardWhen.closest('div')).toHaveTextContent('987,654,321.12345678 XCHAIN');

            cleanup();
            withMessaging(
                <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />,
                messaging({ getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }) }),
            );
            fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
            fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
            fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
            expect(await screen.findByRole('form', { name: 'Review stake' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Create unsigned transaction' })).toBeEnabled();

            cleanup();
            withMessaging(
                <StakingActionForm mode="unstake" walletId="w" chainId={CHAIN} onBack={() => {}} />,
                messaging({
                    getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
                    getStakesForAddress: vi.fn().mockResolvedValue([{
                        amount: '10',
                        status: 'valid',
                        signing_pubkey: PUBKEY,
                    }]),
                }),
            );
            await screen.findByText('10 XCHAIN available');
            fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
            expect(await screen.findByRole('form', { name: 'Review unstake' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Create unsigned transaction' })).toBeEnabled();

            const listNarrow = mediaBlock(readCss(
                'packages/core/src/shared/routes/StakingList.module.css',
            ), '(max-width: 399px)');
            expect(ruleBody(listNarrow, '.row')).toMatch(
                /grid-template-columns:\s*40px\s+minmax\(0, 1fr\)/,
            );
            expect(ruleBody(listNarrow, '.trailing')).toMatch(/grid-column:\s*2/);

            const detailNarrow = mediaBlock(readCss(
                'packages/core/src/shared/routes/StakeDetail.module.css',
            ), '(max-width: 399px)');
            expect(ruleBody(detailNarrow, '.eventRow')).toMatch(/flex-direction:\s*column/);

            const amountNarrow = mediaBlock(readCss(
                'packages/core/src/shared/components/AmountField.module.css',
            ), '(max-width: 399px)');
            expect(ruleBody(amountNarrow, '.amountFooter')).toMatch(/flex-direction:\s*column/);
        } finally {
            cleanup();
            if (widthDescriptor) {
                Object.defineProperty(window, 'innerWidth', widthDescriptor);
            }
        }
    });
});
