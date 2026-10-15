// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: Send confirmation summary clarity.
//
//   [P1] 2026-10-13: Send confirmation repeats its one-line summary, prints
//        the full recipient, and shows device-only guidance to software signers.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActionConfirmScreen } from '../../packages/core/src/shared/components/ActionConfirmScreen.jsx';

const RECIPIENT = 'bc1qrecipient000000000000000000000uvwxyz';
const SUMMARY_LEAD = 'Send 0.5 BTC to';
const HARDWARE_GUIDANCE = /A hardware device verifies native outputs and destinations only/;

function confirmAction() {
    return {
        phase: 'ready',
        composed: {
            bareNativePayment: true,
            chainId: 'bitcoin-mainnet',
            decoded: {
                summary: `${SUMMARY_LEAD} ${RECIPIENT}`,
                details: [
                    { label: 'Destination', value: RECIPIENT },
                    { label: 'Amount', value: '0.5' },
                    { label: 'Token', value: 'BTC' },
                ],
                warnings: [],
            },
        },
        report: null,
        acknowledged: new Set(),
        acknowledge: vi.fn(),
        canApprove: true,
        approve: vi.fn(),
        reject: vi.fn(),
        error: null,
        source: null,
    };
}

function sendScreen(overrides = {}) {
    return (
        <ActionConfirmScreen
            confirmAction={confirmAction()}
            chainId="bitcoin-mainnet"
            chainLabel="Bitcoin"
            signerReady
            password=""
            onPasswordChange={vi.fn()}
            {...overrides}
        />
    );
}

afterEach(() => cleanup());

describe('regression/confirm-summary-once', () => {
    it('[REGRESSION P1] shows the Send summary once', () => {
        render(sendScreen());

        const review = screen.getByTestId('confirm-modal').cloneNode(true);
        review.querySelector('footer')?.remove();
        expect(review.textContent.split(SUMMARY_LEAD)).toHaveLength(2);
    });

    it('[REGRESSION P1] renders the recipient with AddressText truncation', () => {
        render(sendScreen());

        const address = Array.from(screen.getByTestId('confirm-modal').querySelectorAll('[title]'))
            .find((node) => node.getAttribute('title') === RECIPIENT);
        expect(address).toBeTruthy();
        expect(address).toHaveAttribute('aria-label', RECIPIENT);
        expect(address).toHaveTextContent('bc1qre…uvwxyz');
        expect(address).not.toHaveTextContent(RECIPIENT);
    });

    it('[REGRESSION P1] omits hardware-device guidance for a software signer', () => {
        render(sendScreen());
        expect(screen.queryByText(HARDWARE_GUIDANCE)).toBeNull();
    });

    it('[REGRESSION P1] shows hardware-device guidance for a hardware signer', () => {
        render(sendScreen({
            signerReady: false,
            hwSource: {
                address: 'bc1qhardware0000000000000000000000source',
                source: 'ledger',
                signerId: 'ledger-regression',
                signerLabel: 'Ledger',
                derivationPath: "m/84'/0'/0'/0/0",
            },
            hwStatus: 'available',
        }));
        expect(screen.getByText(HARDWARE_GUIDANCE)).toBeInTheDocument();
    });
});
