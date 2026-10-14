// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { StakeDetail } from '../../../packages/core/src/shared/routes/StakeDetail.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { StakeNew } from '../../../packages/core/src/shared/routes/StakeNew.jsx';
import { StakingActionForm } from '../../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '../../../packages/core/src/shared/routes/DelegationActionForm.jsx';
import { StakingList } from '../../../packages/core/src/shared/routes/StakingList.jsx';
import listRowStyles from '../../../packages/core/src/ui/ListRow.module.css';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const PUBKEY = 'a'.repeat(64);
const VALID_ADDRESS = 'bc1qdevmockabcdef';
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

    it('turns indexer internals into plain staking-list copy', async () => {
        const internal = new Error('getStakesForAddress: request failed with status code 500 at https://indexer.invalid/api/stakes');
        withMessaging(
            <StakingList walletId="w" onOpenStake={() => {}} onNewStake={() => {}} onBack={() => {}} />,
            messaging({
                getStakesForAddress: vi.fn().mockRejectedValue(internal),
                getDelegationsForAddress: vi.fn().mockRejectedValue(internal),
                getRewardsForAddress: vi.fn().mockRejectedValue(internal),
            }),
        );

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load validator stakes. Something went wrong. Try again.");
        expect(alert).not.toHaveTextContent('indexer.invalid');
        expect(alert).not.toHaveTextContent('getStakesForAddress');
    });

    it('does not show an unverified claimable total when the claim ledger fails', async () => {
        const internal = new Error('getRewardClaimsForAddress: request failed at https://indexer.invalid/api/claims');
        withMessaging(
            <StakingList walletId="w" onOpenStake={() => {}} onNewStake={() => {}} onBack={() => {}} />,
            messaging({
                getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]),
                getRewardClaimsForAddress: vi.fn().mockRejectedValue(internal),
            }),
        );

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load claimed staking rewards. Something went wrong. Try again.");
        expect(screen.queryByText(/ready to claim/)).toBeNull();
        expect(alert).not.toHaveTextContent('indexer.invalid');
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
    it('validates empty, zero, and over-precision amounts before composing', async () => {
        const methods = messaging();
        withMessaging(
            <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );

        const submit = await screen.findByRole('button', { name: 'Stake' });
        expect(submit).toBeEnabled();

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '-1' } });
        expect(await screen.findByText(/Enter a valid decimal amount/)).toBeInTheDocument();

        fireEvent.click(submit);
        expect(await screen.findByText('Enter an amount to stake.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '0' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
        fireEvent.click(submit);
        expect(await screen.findByText('Amount must be greater than zero.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1.123456789' } });
        fireEvent.click(submit);
        expect(await screen.findByText('Amount can have at most 8 decimal places.')).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
    });

    it('validates an empty signing key before composing', async () => {
        const methods = messaging();
        withMessaging(
            <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );

        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));
        expect(await screen.findByText('Enter the signing public key.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: 'not-hex' } });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));
        expect(await screen.findByText(/exactly 64 hexadecimal characters/)).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
    });

    it('blocks review when an invalid custom fee would be omitted from the STAKE build', async () => {
        const methods = messaging();
        withMessaging(
            <StakeForm walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));

        expect(await screen.findByText('Enter a custom network fee rate greater than zero.')).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
    });

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
        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '1.23000000' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: PUBKEY } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/Stake 1.23000000 XCHAIN for signing public key/)).toBeInTheDocument();
        expect(screen.getByText('After 6 BTC blocks')).toBeInTheDocument();
        expect(screen.getByText('Network fee')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^Amount/)).toHaveValue('1.23000000');
        expect(screen.getByLabelText('Signing public key')).toHaveValue(PUBKEY);
    });
});

describe('staking action load and review state', () => {
    it('validates an empty and zero amount before composing', async () => {
        const methods = messaging({
            getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]),
        });
        withMessaging(
            <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );
        await screen.findByText('10 XCHAIN available');
        const amount = screen.getByLabelText(/^Amount/);
        const submit = screen.getByRole('button', { name: 'Claim rewards' });

        fireEvent.change(amount, { target: { value: '' } });
        fireEvent.click(submit);
        expect(await screen.findByText('Enter an amount.')).toBeInTheDocument();

        fireEvent.change(amount, { target: { value: '0' } });
        fireEvent.click(submit);
        expect(await screen.findByText('Amount must be greater than zero.')).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
    });

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

    it('does not treat a failed claim-ledger read as no prior claims', async () => {
        const internal = new Error('getRewardClaimsForAddress: request failed at https://indexer.invalid/api/claims');
        withMessaging(
            <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            messaging({
                getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]),
                getRewardClaimsForAddress: vi.fn().mockRejectedValue(internal),
            }),
        );

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load the available staking balance. Something went wrong. Try again.");
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(alert).not.toHaveTextContent('indexer.invalid');
        expect(screen.getByRole('button', { name: 'Claim rewards' })).toBeDisabled();
    });

    it('blocks review when an invalid custom fee would be omitted from the COLLECT build', async () => {
        const methods = messaging({
            getRewardsForAddress: vi.fn().mockResolvedValue([{ amount: '10' }]),
        });
        withMessaging(
            <StakingActionForm mode="claim-rewards" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );
        await screen.findByText('10 XCHAIN available');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Claim rewards' }));

        expect(await screen.findByText('Enter a custom network fee rate greater than zero.')).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
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
        fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '4.50000000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/Claim 4.50000000 XCHAIN/)).toBeInTheDocument();
        expect(screen.getByText('Network fee')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^Amount/)).toHaveValue('4.50000000');
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

describe('delegation validation and review state', () => {
    function delegationMessaging(overrides = {}) {
        return messaging({
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{ ...ADDRESS_ROW, address: VALID_ADDRESS }],
            }),
            ...overrides,
        });
    }

    it('validates an empty signing key before composing', async () => {
        const methods = delegationMessaging();
        withMessaging(
            <DelegationActionForm mode="delegate" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );

        const submit = await screen.findByRole('button', { name: 'Delegate signing key' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        expect(await screen.findByText('Enter the new signing public key.')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('New signing pubkey'), { target: { value: 'not-hex' } });
        fireEvent.click(submit);
        expect(await screen.findByText(/exactly 64 hex characters/)).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
    });

    it('surfaces a plain indexer error when the revoke key cannot be prefilled', async () => {
        const internal = new Error('getDelegationsForAddress: request failed at https://indexer.invalid/api/delegations');
        withMessaging(
            <DelegationActionForm mode="revoke" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            delegationMessaging({
                getDelegationsForAddress: vi.fn().mockRejectedValue(internal),
            }),
        );

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load the current delegation. Something went wrong. Try again.");
        expect(alert).toHaveTextContent('Enter the signing public key manually.');
        expect(alert).not.toHaveTextContent('indexer.invalid');
    });

    it('blocks review when an invalid custom fee would be omitted from the DELEGATE build', async () => {
        const methods = delegationMessaging();
        withMessaging(
            <DelegationActionForm mode="delegate" walletId="w" chainId={CHAIN} onBack={() => {}} />,
            methods,
        );
        fireEvent.change(await screen.findByLabelText('New signing pubkey'), { target: { value: PUBKEY } });
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Delegate signing key' }));

        expect(await screen.findByText('Enter a custom network fee rate greater than zero.')).toBeInTheDocument();
        expect(methods.composeForConfirm).not.toHaveBeenCalled();
    });

    it('returns from review with the exact signing key preserved', async () => {
        const onBack = vi.fn();
        withMessaging(
            <DelegationActionForm mode="delegate" walletId="w" chainId={CHAIN} onBack={onBack} />,
            delegationMessaging({
                getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            }),
        );
        const key = 'B'.repeat(64);
        fireEvent.change(await screen.findByLabelText('New signing pubkey'), { target: { value: key } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByText(key.toLowerCase())).toBeInTheDocument();
        expect(screen.getByText('Network fee')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByLabelText('New signing pubkey')).toHaveValue(key);
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

            const rewardList = await screen.findByRole('list', { name: 'Reward events' });
            const rewardItem = within(rewardList).getByRole('listitem');
            const rewardRow = rewardItem.querySelector(`.${listRowStyles.row}`);
            expect(rewardRow).toBeInTheDocument();
            expect(rewardItem).toHaveTextContent('987,654,321.12345678 XCHAIN');
            expect(within(rewardItem).getByText('block 98')).toBeInTheDocument();
            expect(within(rewardItem).queryByRole('button')).toBeNull();
            expect(within(rewardItem).queryByRole('link')).toBeNull();

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
            ), 'not all and (min-width: 400px)');
            expect(ruleBody(listNarrow, '.row')).toMatch(
                /grid-template-columns:\s*40px\s+minmax\(0, 1fr\)/,
            );
            expect(ruleBody(listNarrow, '.trailing')).toMatch(/grid-column:\s*2/);

            const amountNarrow = mediaBlock(readCss(
                'packages/core/src/shared/components/AmountField.module.css',
            ), 'not all and (min-width: 400px)');
            expect(ruleBody(amountNarrow, '.amountFooter')).toMatch(/flex-direction:\s*column/);
        } finally {
            cleanup();
            if (widthDescriptor) {
                Object.defineProperty(window, 'innerWidth', widthDescriptor);
            }
        }
    });
});
