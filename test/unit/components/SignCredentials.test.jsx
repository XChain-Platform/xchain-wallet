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
//   unlocked -> "Wallet unlocked. No password needed."
//
// The unlocked branch used to return that note ALONE, dropping submitError on
// the floor. The calling forms only render their own error banner for the
// watcher / hardware paths, so a failed submit on an unlocked software wallet
// had nowhere at all to surface: pressing Sign did nothing visible. A user
// cannot tell a rejected transaction from a dead button, and will press again.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

        // The reassuring note is still there...
        expect(screen.getByText(/no password needed/i)).toBeTruthy();
        // ...and so is the failure, which is the whole point.
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

        expect(screen.getByText(/no password needed/i)).toBeTruthy();
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

        expect(screen.getByLabelText(/password/i)).toBeTruthy();
        expect(screen.getByText('Incorrect password.')).toBeTruthy();
    });
});
