// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// regression guard.
//
// SignCredentials is the shared sign-screen block rendered by 18 of the 19
// signing forms in the wallet, so a hole here is a hole in nearly every
// signing path. It has two software branches:
//
//   locked   -> a password Input, which carries submitError on its `error` prop
//   unlocked -> no password Input, with submitError rendered beside panic status
//
// Keep the unlocked branch's submit error visible because the password Input
// cannot carry it. A user otherwise cannot distinguish a rejected transaction
// from a dead button and may submit again.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';

afterEach(() => cleanup());

const softwareAddress = { address: 'bc1qexample', source: 'hd' };

describe('SignCredentials', () => {
    it('surfaces a submit error when the wallet is UNLOCKED (no password field to carry it)', () => {
        render(
            <SignCredentials
                unlocked
                fromAddress={softwareAddress}
                chainId="bitcoin-mainnet"
                submitError="Insufficient funds."
            />,
        );

        expect(screen.queryByText(/no password needed/i)).toBeNull();
        // Keep the failure visible when there is no password Input to carry it.
        expect(screen.getByText('Insufficient funds.')).toBeTruthy();
    });

    it('does not invent an error banner when the submit has not failed', () => {
        render(
            <SignCredentials
                unlocked
                fromAddress={softwareAddress}
                chainId="bitcoin-mainnet"
                submitError={null}
            />,
        );

        expect(screen.queryByText(/no password needed/i)).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('still carries the error on the password field when the wallet is LOCKED', () => {
        render(
            <SignCredentials
                unlocked={false}
                fromAddress={softwareAddress}
                chainId="bitcoin-mainnet"
                password=""
                submitError="Incorrect password."
            />,
        );

        expect(screen.getByLabelText(/password/i, { selector: 'input' })).toBeTruthy();
        expect(screen.getByText('Incorrect password.')).toBeTruthy();
    });

    it('does not restart hardware status polling when the parent rerenders', async () => {
        const hardwareAddress = {
            address: 'bc1qhardware',
            source: 'ledger',
            signerId: 'ledger-1',
            derivationPath: "m/84'/0'/0'/0/0",
        };
        const getSignerStatus = vi.fn().mockResolvedValue({ status: 'available' });
        const view = render(
            <SignCredentials
                fromAddress={hardwareAddress}
                chainId="bitcoin-mainnet"
                getSignerStatus={getSignerStatus}
            />,
        );
        await act(async () => Promise.resolve());

        view.rerender(
            <SignCredentials
                fromAddress={hardwareAddress}
                chainId="bitcoin-mainnet"
                getSignerStatus={getSignerStatus}
            />,
        );
        await act(async () => Promise.resolve());

        expect(getSignerStatus).toHaveBeenCalledTimes(1);
    });
});
