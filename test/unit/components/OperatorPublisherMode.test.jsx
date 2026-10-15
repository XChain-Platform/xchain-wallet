// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lane = vi.hoisted(() => ({
    hook: vi.fn(),
    run: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/hooks/useOwnerActionLane.js', () => ({
    useOwnerActionLane: (args) => {
        lane.hook(args);
        return {
            open: false,
            composing: false,
            isWatcherMode: false,
            hw: false,
            run: lane.run,
            confirmProps: {},
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({ flag: undefined, mandatory: false }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerReady.js', () => ({
    useSignerReady: () => true,
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerInfo.js', () => ({
    useSignerInfo: () => null,
}));

vi.mock('../../../packages/core/src/flows/feeEstimate.js', () => ({
    estimateNativeSendFee: () => null,
    estimateNativeSendFeeTiers: () => null,
    customFeeEstimate: () => null,
    displayRateToSettingsCustom: () => null,
}));

import { OperatorPublisherMode } from '../../../packages/core/src/shared/components/OperatorPublisherMode.jsx';

const OWNER = {
    id: 'address-1',
    address: 'bc1qpublisher',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mount({ messaging: suppliedMessaging, props = {} } = {}) {
    const messaging = suppliedMessaging || {
        getAddressesByChain: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [OWNER],
        }),
    };
    render(
        <OperatorPublisherMode
            walletId="wallet-1"
            chainId="bitcoin-mainnet"
            address={OWNER.address}
            feed={{ action_index: 41 }}
            messaging={messaging}
            variant="page"
            {...props}
        />,
    );
    return messaging;
}

beforeEach(() => {
    lane.hook.mockClear();
    lane.run.mockReset();
    lane.run.mockResolvedValue({ txid: '1234567890abcdef1234' });
});

afterEach(() => cleanup());

describe('OperatorPublisherMode', () => {
    it('starts collapsed and toggles the publisher form', async () => {
        mount();

        const toggle = screen.getByRole('button', { name: 'Enter publisher mode' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByLabelText('Value')).toBeNull();

        fireEvent.click(toggle);

        expect(screen.getByRole('button', { name: 'Leave publisher mode' }))
            .toHaveAttribute('aria-expanded', 'true');
        expect(await screen.findByLabelText('Feed reference number')).toHaveValue('41');
        expect(screen.getByLabelText('Value')).toHaveValue('');
    });

    it('allows the prefilled feed reference to be cleared for correction', async () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));
        const reference = await screen.findByLabelText('Feed reference number');

        fireEvent.change(reference, { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: '12.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));

        expect(reference).toHaveValue('');
        expect(screen.getByRole('alert')).toHaveTextContent('Feed reference number is required.');
        expect(lane.run).not.toHaveBeenCalled();
    });

    it('validates both fields with plain copy before opening review', async () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));
        await waitFor(() => expect(screen.queryByText('Loading source address…')).toBeNull());

        fireEvent.change(screen.getByLabelText('Feed reference number'), { target: { value: '4.2' } });
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Feed reference number must be a positive whole number.',
        );

        fireEvent.change(screen.getByLabelText('Feed reference number'), { target: { value: '42' } });
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'twelve' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Value must be a number.');
        expect(lane.run).not.toHaveBeenCalled();
    });

    it.each(['Infinity', '1e3', '0x10'])('rejects non-decimal value %s before review', async (value) => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));
        await waitFor(() => expect(screen.queryByText('Loading source address…')).toBeNull());

        fireEvent.change(screen.getByLabelText('Value'), { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Value must be a number.');
        expect(lane.run).not.toHaveBeenCalled();
    });

    it('distinguishes a feed lookup in progress from a failed lookup', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [OWNER] }),
        };
        const view = render(
            <OperatorPublisherMode
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                address={OWNER.address}
                feed={null}
                feedLoading
                messaging={messaging}
                variant="page"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));

        expect(screen.getByText('Loading the most recent feed for this address.')).toBeInTheDocument();
        expect(screen.queryByText(/No feed found for this address/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Feed reference number'), { target: { value: '99' } });

        view.rerender(
            <OperatorPublisherMode
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                address={OWNER.address}
                feed={{ action_index: 44 }}
                messaging={messaging}
                variant="page"
            />,
        );
        expect(screen.getByLabelText('Feed reference number')).toHaveValue('99');

        view.rerender(
            <OperatorPublisherMode
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                address={OWNER.address}
                feed={null}
                feedError="Couldn't load the latest feed. Try again."
                messaging={messaging}
                variant="page"
            />,
        );
        expect(screen.getByLabelText('Feed reference number')).toHaveValue('99');
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the latest feed. Try again.");
    });

    it('clears the form before loading a different wallet and network', async () => {
        const nextOwner = { ...OWNER, id: 'address-2', address: 'ltc1qpublisher' };
        const messaging = {
            getAddressesByChain: vi.fn().mockImplementation((walletId) => Promise.resolve(
                walletId === 'wallet-1'
                    ? { 'bitcoin-mainnet': [OWNER] }
                    : { 'litecoin-mainnet': [nextOwner] },
            )),
        };
        const view = render(
            <OperatorPublisherMode
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                address={OWNER.address}
                feed={{ action_index: 41 }}
                messaging={messaging}
                variant="page"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));
        await waitFor(() => expect(screen.queryByText('Loading source address…')).toBeNull());
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'private old value' } });

        view.rerender(
            <OperatorPublisherMode
                walletId="wallet-2"
                chainId="litecoin-mainnet"
                address={nextOwner.address}
                feed={{ action_index: 82 }}
                messaging={messaging}
                variant="page"
            />,
        );

        expect(screen.queryByLabelText('Value')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));
        expect(await screen.findByLabelText('Feed reference number')).toHaveValue('82');
        expect(screen.getByLabelText('Value')).toHaveValue('');
    });

    it('turns a source lookup failure into plain copy instead of loading forever', async () => {
        mount({
            messaging: {
                getAddressesByChain: vi.fn().mockRejectedValue(
                    new TypeError('Cannot read properties of undefined'),
                ),
            },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't load the source address. Try again.",
        );
        expect(screen.queryByText(/Cannot read properties/)).toBeNull();
        expect(screen.queryByText('Loading source address…')).toBeNull();
    });

    it('publishes trimmed values through the owner confirmation lane', async () => {
        const messaging = mount();
        fireEvent.click(screen.getByRole('button', { name: 'Enter publisher mode' }));

        await waitFor(() => expect(lane.hook).toHaveBeenLastCalledWith(expect.objectContaining({
            messaging,
            walletId: 'wallet-1',
            chainId: 'bitcoin-mainnet',
            owner: OWNER,
            software: 'broadcastAction',
            hardware: 'broadcastActionHw',
        })));

        fireEvent.change(screen.getByLabelText('Feed reference number'), {
            target: { value: ' 42 ' },
        });
        fireEvent.change(screen.getByLabelText('Value'), { target: { value: ' 12.5 ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Publish value' }));

        await waitFor(() => expect(lane.run).toHaveBeenCalledWith({
            actionData: {
                action: 'BROADCAST',
                params: {
                    VERSION: '3',
                    BROADCAST_ACTION_INDEX: '42',
                    VALUE: '12.5',
                },
            },
            encoderOpts: { payFeeInNativeCoin: undefined },
            submitExtra: {
                params: {
                    VERSION: '3',
                    BROADCAST_ACTION_INDEX: '42',
                    VALUE: '12.5',
                },
            },
        }));
        expect(await screen.findByText('Last published: txid 1234567890abcdef…'))
            .toBeInTheDocument();
        expect(screen.getByLabelText('Value')).toHaveValue('');
    });
});
