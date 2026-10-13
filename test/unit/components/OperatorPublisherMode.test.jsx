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

function mount() {
    const messaging = {
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
