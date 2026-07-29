// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The chain picker must say WHICH chain question it is answering.
//
// Its visible label is a plain <span> beside the trigger, not a <label for>, so
// the trigger used to take its whole accessible name from the selection:
// "Bitcoin · regtest, button". One picker on a form is merely vague. The case
// that makes it a defect rather than a nicety is CrossChainSwapForm, which
// renders "Give chain" and "Get chain" side by side - two buttons a screen
// reader announced identically, on the one control pair where transposing them
// sends the money the wrong way.
//
// These tests pin the accessible name in BOTH directions: the label must be in
// it, and a picker given no label must NOT gain a stray "undefined: " prefix.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChainPicker } from '../../../packages/core/src/ui/ChainPicker.jsx';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const reg = defaultRegistry();
const CHAINS = ['bitcoin-regtest', 'litecoin-regtest'];

describe('<ChainPicker> accessible name', () => {
    it('names the field and the current selection', () => {
        render(
            <ChainPicker
                label="Network"
                value="bitcoin-regtest"
                chainIds={CHAINS}
                chainRegistry={reg}
                onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin · regtest' }))
            .toBeInTheDocument();
    });

    it('distinguishes two pickers on one screen, which is the cross-chain case', () => {
        render(
            <>
                <ChainPicker
                    label="Give chain" value="bitcoin-regtest"
                    chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
                />
                <ChainPicker
                    label="Get chain" value="litecoin-regtest"
                    chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
                />
            </>,
        );
        // The bug this replaces: both of these matched the same query.
        expect(screen.getByRole('button', { name: /^Give chain:/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Get chain:/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Give chain: Bitcoin · regtest' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get chain: Litecoin · regtest' }))
            .toBeInTheDocument();
    });

    it('names the placeholder when nothing is selected yet', () => {
        render(
            <ChainPicker
                label="Coin" value="" placeholder="Select a network"
                chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Coin: Select a network' }))
            .toBeInTheDocument();
    });

    it('honours hideNetworkKind, so the name matches what is on screen', () => {
        render(
            <ChainPicker
                label="Network" value="bitcoin-regtest" hideNetworkKind
                chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /regtest/ })).toBeNull();
    });

    it('leaves an unlabelled picker naming itself by its selection', () => {
        // A guard against the obvious wrong fix: interpolating an absent label
        // would announce "undefined: Bitcoin · regtest".
        render(
            <ChainPicker
                value="bitcoin-regtest"
                chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.queryByRole('button', { name: /undefined/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Bitcoin/ })).toBeInTheDocument();
    });
});

// The sibling found by sweeping the same shape (a <span> label beside an
// unlabelled trigger) across `ui/` and `shared/components/`: ChainPicker and
// IconSelect were the only two, and TokenField was already correct.
describe('<IconSelect> accessible name', () => {
    const OPTIONS = [
        { value: 'ecdh', label: 'Encrypted' },
        { value: 'none', label: 'Plain text' },
    ];

    it('names the field and the current selection', () => {
        render(
            <IconSelect label="Encryption" value="ecdh" options={OPTIONS} onChange={() => {}} />,
        );
        expect(screen.getByRole('button', { name: 'Encryption: Encrypted' })).toBeInTheDocument();
    });

    it('distinguishes the two selects ComposeMessage renders together', () => {
        render(
            <>
                <IconSelect label="Encryption" value="ecdh" options={OPTIONS} onChange={() => {}} />
                <IconSelect
                    label="Delivery network" value="ecdh" options={OPTIONS} onChange={() => {}}
                />
            </>,
        );
        expect(screen.getByRole('button', { name: /^Encryption:/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Delivery network:/ })).toBeInTheDocument();
    });

    it('names the placeholder when nothing is selected, and never "undefined"', () => {
        render(
            <>
                <IconSelect label="Encryption" value="" placeholder="Select…" options={OPTIONS} onChange={() => {}} />
                <IconSelect value="ecdh" options={OPTIONS} onChange={() => {}} />
            </>,
        );
        expect(screen.getByRole('button', { name: 'Encryption: Select…' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /undefined/ })).toBeNull();
    });
});
