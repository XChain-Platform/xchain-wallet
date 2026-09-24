// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ActionConfirmScreen From row (#40). ConfirmActionModal.test.jsx already
// pins the row's rendering given a `sourceAddress` prop directly; this file
// pins the layer above it, where ActionConfirmScreen DERIVES that address
// (`confirmAction.source || hwSource?.address`) so the row appears for a
// software signer and a hardware signer alike, not only when a caller
// remembers to pass the prop itself.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';

afterEach(() => cleanup());

const SOFTWARE_ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const HARDWARE_ADDRESS = 'ndDEAAqTMcJmDFEHkLPfEjGvPTyY4NVoTY';

function confirmAction(overrides = {}) {
    return {
        phase: 'ready',
        composed: null,
        report: null,
        acknowledged: new Set(),
        acknowledge: () => {},
        canApprove: true,
        approve: () => {},
        reject: () => {},
        error: null,
        source: null,
        ...overrides,
    };
}

describe('ActionConfirmScreen From row (#40)', () => {
    it('names the spender for a software signer, from confirmAction.source', () => {
        render(
            <ActionConfirmScreen
                confirmAction={confirmAction({ source: SOFTWARE_ADDRESS })}
                chainLabel="Bitcoin"
                signerReady={false}
                password="hunter2"
                onPasswordChange={() => {}}
            />,
        );

        const row = screen.getByTestId('confirm-source');
        expect(row.textContent).toMatch(/^From/);
        // AddressText truncates for display and carries the full string on
        // title, which is what a user comparing against their address list
        // needs to be able to read.
        expect(row.querySelector('[title]')?.getAttribute('title')).toBe(SOFTWARE_ADDRESS);
    });

    // The confirm hook does not always carry `source` (older callers, or a
    // record form): hwSource.address is the named fallback for exactly that
    // gap, so a device signer is not the one case left with a blank row.
    it('names the spender for a hardware signer, from hwSource.address', () => {
        render(
            <ActionConfirmScreen
                confirmAction={confirmAction({ source: null })}
                chainLabel="Bitcoin"
                signerReady={false}
                password=""
                onPasswordChange={() => {}}
                hwSource={{
                    address: HARDWARE_ADDRESS,
                    source: 'trezor',
                    signerId: 'signer-hw',
                    derivationPath: "m/84'/0'/0'/0/0",
                }}
                hwStatus="available"
            />,
        );

        const row = screen.getByTestId('confirm-source');
        expect(row.textContent).toMatch(/^From/);
        expect(row.querySelector('[title]')?.getAttribute('title')).toBe(HARDWARE_ADDRESS);
    });
});
