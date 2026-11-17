// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DerivationPathCrossCheck } from '../../../packages/core/src/shared/components/DerivationPathCrossCheck.jsx';

afterEach(() => cleanup());

describe('DerivationPathCrossCheck help copy', () => {
    it('shows the read-only derivation path with no help icon (G121)', () => {
        render(
            <DerivationPathCrossCheck
                signerName="Test device"
                signerKind="trezor"
                path="m/84'/0'/0'/0/0"
                address="bc1qexample"
            />,
        );

        expect(screen.queryByRole('button', { name: 'Account path help' })).toBeNull();
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('explains a mismatch plainly and leaves the derivation path unchanged', () => {
        const path = "m/84'/0'/7'/0/3";
        render(
            <DerivationPathCrossCheck
                signerName="Test Ledger"
                signerKind="ledger"
                path={path}
                address="bc1qexample"
            />,
        );

        expect(screen.getByText(path)).toHaveTextContent(path);
        expect(screen.getByText(/device may be using a different account or signing address/i))
            .toHaveTextContent(/Reject on the device\. Nothing is signed/i);
    });

    it('keeps confirmation when only the callback identity changes', () => {
        const props = {
            signerName: 'Test Ledger',
            signerKind: 'ledger',
            path: "m/84'/0'/0'/0/0",
            address: 'bc1qexample',
            requireExplicitConfirm: true,
        };
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        const { rerender } = render(
            <DerivationPathCrossCheck {...props} onConfirmedChange={firstCallback} />,
        );
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();

        rerender(
            <DerivationPathCrossCheck {...props} onConfirmedChange={secondCallback} />,
        );

        expect(checkbox).toBeChecked();
        expect(secondCallback).not.toHaveBeenCalled();
    });
});
