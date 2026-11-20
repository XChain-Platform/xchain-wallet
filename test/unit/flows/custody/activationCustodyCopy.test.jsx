// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An account skipped because another signer holds it is never reported as
// already having the network: the settings toast names it apart, and the
// hardware Add network row reads it as a failed add.

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { activationMessage } from '../../../../packages/core/src/shared/components/settings/TestNetworksPages.jsx';
import { useAddHardwareNetwork } from '../../../../packages/core/src/shared/components/hardware/HardwareNetworkRow.jsx';

const descriptor = { id: 'bitcoin-regtest', displayName: 'Bitcoin Regtest' };
const otherSigner = { accountId: 'acct-b', name: 'Cold', reason: 'custody-mismatch' };

describe('activation results for accounts another signer holds', () => {
    it('names the other-signer account instead of calling the network already active', () => {
        const message = activationMessage(descriptor, { addresses: [], skippedAccountDetails: [otherSigner] });
        expect(message).toBe('No address made for accounts another signer holds: Cold.');
    });

    it('keeps the made count and the already-had list beside the other-signer line', () => {
        const message = activationMessage(descriptor, {
            addresses: [{ accountId: 'acct-a' }],
            skippedAccountDetails: [{ accountId: 'acct-c', name: 'Savings' }, otherSigner],
        });
        expect(message).toBe('Bitcoin Regtest is active. New addresses made: 1. '
            + 'Already had an address on it, so left unchanged: Savings. '
            + 'No address made for accounts another signer holds: Cold.');
    });

    it('marks a hardware add failed when the device does not hold the account', async () => {
        const onAdded = vi.fn();
        const messaging = {
            activateChainRequest: vi.fn(async () => ({ addresses: [], skippedAccountDetails: [otherSigner] })),
        };
        const { result } = renderHook(() => useAddHardwareNetwork({
            messaging, walletId: 'w1', signerId: 'device-1', onAdded,
        }));
        let added;
        await act(async () => { added = await result.current.add('acct-b', 'bitcoin-regtest'); });
        expect(added).toBe(false);
        expect(onAdded).not.toHaveBeenCalled();
        expect(Object.values(result.current.states)).toEqual(['failed']);
    });
});
