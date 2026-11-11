// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Token field on an added recipient row carries the shared help tip, written
// for that field; the bare picker without help draws no tip.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send, AssetIconPicker } from '../../../packages/core/src/shared/routes/Send.jsx';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect, onBack }) => (
        <section aria-label={title}>
            <h2>{title}</h2>
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'XCP' })}>Pick XCP</button>
            <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'PEPE' })}>Pick PEPE</button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';
const ALICE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const BOB = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: FROM,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
    }],
};

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [
                { tick: 'PEPE', quantity: '1000', divisibility: 0 },
                { tick: 'XCP', quantity: '100000000000', divisibility: 8 },
            ],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe("AssetIconPicker help", () => {
    it("draws the field label and help tip when help is given", () => {
        render(<AssetIconPicker label="Recipient 2 token" chainId={CHAIN} tick="XCP" onOpen={() => {}} help="Pick a token." />);
        expect(screen.getByText("Token")).toBeTruthy();
        expect(screen.getByRole("button", { name: "About Token" })).toBeTruthy();
    });

    it("draws nothing extra when help is not given", () => {
        render(<AssetIconPicker label="Recipient 2 token" chainId={CHAIN} tick="XCP" onOpen={() => {}} />);
        expect(screen.queryByText("Token")).toBeNull();
        expect(screen.queryByRole("button", { name: "About Token" })).toBeNull();
        expect(screen.getByRole("button", { name: "Recipient 2 token: XCP. Change asset" })).toBeTruthy();
    });
});

describe("Send: added recipient Token field help", () => {
    it("shows the help tip on the added recipient token row", async () => {
        mount();
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: ALICE } });
        fireEvent.change(screen.getByLabelText(/^Token$/), { target: { value: "PEPE" } });
        fireEvent.change(screen.getByLabelText(/^Amount \(/), { target: { value: "7" } });
        await screen.findByText(/PEPE available/);
        fireEvent.click(await screen.findByRole("button", { name: /Add recipient/ }));
        fireEvent.click(screen.getByRole("switch", { name: /different token/i }));
        await screen.findByRole("button", { name: /Recipient 2 token/ });
        const tips = screen.getAllByRole("button", { name: "About Token" });
        expect(tips).toHaveLength(2);
        fireEvent.click(tips[1]);
        expect(await screen.findByText(/The token this recipient receives/)).toBeTruthy();
    });
});
