// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DerivationPathCrossCheck } from '../../../packages/core/src/shared/components/DerivationPathCrossCheck.jsx';

afterEach(() => cleanup());

describe('DerivationPathCrossCheck help copy', () => {
    it('explains the safety check briefly without a specification number', () => {
        render(
            <DerivationPathCrossCheck
                signerName="Test device"
                signerKind="trezor"
                path="m/84'/0'/0'/0/0"
                address="bc1qexample"
            />,
        );

        fireEvent.focus(screen.getByRole('button', { name: 'Derivation path help' }));
        const tip = screen.getByRole('tooltip');
        expect(tip.textContent).toBe(
            'Locates this account within your recovery phrase. Compare it with your device to make sure you sign from the intended account.',
        );
        expect(tip.textContent.length).toBeLessThan(140);
        expect(tip.textContent).not.toMatch(/BIP\d+/i);
    });
});
