// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const state = vi.hoisted(() => ({
    watcher: false,
    messaging: {},
    submit: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: state.messaging, shell: 'web' }),
    screenVariantFor: () => 'web',
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: state.watcher }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useActionForm.js', () => ({
    useActionForm: () => {
        const fromAddress = {
            id: 'address-1',
            address: 'mSourceAddress',
            publicKey: '02abcd',
            derivationPath: "m/84'/1'/0'/0/0",
            signerId: 'signer-1',
            source: 'hd',
        };
        return {
            addressesByChain: { 'bitcoin-regtest': [fromAddress] },
            loadError: null,
            chainId: 'bitcoin-regtest',
            setChainId: vi.fn(),
            chainsWithAddresses: ['bitcoin-regtest'],
            fromAddress,
            setFromAddressId: vi.fn(),
            descriptor: {
                id: 'bitcoin-regtest',
                coin: 'bitcoin',
                displayName: 'Bitcoin Regtest',
                networkKind: 'regtest',
                ticker: 'BTC',
            },
            signerReady: true,
            isHwSource: false,
            hwStatus: 'available',
            onHwStatusChange: vi.fn(),
            buildFrom: () => fromAddress,
            submit: state.submit,
        };
    },
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { preflightPrivacy: 'report' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', () => ({
    useConfirmAction: () => ({
        phase: 'idle',
        composing: false,
        confirm: state.confirm,
    }),
}));

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({ actionIndex: '7', name: title.includes('Allow') ? 'Team wallets' : undefined, memberCount: 4 })}
        >
            List row {title}
        </button>
    ),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerInfo.js', () => ({
    useSignerInfo: () => null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({
        flag: undefined,
        mandatory: false,
        toggleProps: { checked: false, onChange: vi.fn(), mandatory: false },
    }),
}));

import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';

import buttonStyles from "../../../packages/core/src/ui/Button.module.css";
import { openOrderSection, pickOrderAsset, showFullOrderView } from "../../helpers/orderAssetPicker.js";

// Create order follows the shared field and button rulings: the From field
// is named From and carries the settle-on-one-network note in its help tip,
// every field label has a "?" tip, Max sits inside both amount fields (U61),
// and Place order is the one green action with an icon, never "Preview"
// (U63), with My orders, the list buttons and Edit carrying icons too.

async function renderForm() {
    render(<CreateOrderForm walletId="wallet-1" onBack={vi.fn()} onManageOrders={vi.fn()} />);
    await screen.findAllByDisplayValue("mSourceAddress");
}

const hasIcon = (button) => button.querySelector("svg") !== null;

beforeEach(() => {
    state.watcher = false;
    state.submit.mockReset().mockResolvedValue({ txid: "tx-123" });
    state.confirm.mockReset();
    state.messaging = {
        getSettings: vi.fn(async () => ({ preflightPrivacy: "report" })),
        getAutopayExposure: vi.fn(async () => ({ total: 0 })),
        getTokenInfo: vi.fn(async () => ({ divisibility: 8 })),
        getWalletBalances: vi.fn(async () => ({
            "bitcoin-regtest": [{
                address: "mSourceAddress",
                balances: {
                    native: { tick: "BTC", quantity: "100000000", divisibility: 8 },
                    tokens: [{ tick: "XCP", quantity: "1000", divisibility: 8 }],
                },
            }],
        })),
        getSignerStatus: vi.fn(async () => ({ status: "unlocked" })),
    };
    localStorage.clear();
});

afterEach(() => cleanup());

describe("CreateOrderForm shared rulings", () => {
    it("names the source field From and moves the network note into its tip", async () => {
        showFullOrderView();
        await renderForm();
        expect(screen.queryByText(/Both sides of this order settle on the same chain/)).toBeNull();
        expect(screen.getByLabelText("From address").labels[0].textContent).toBe("From address");
        openOrderSection("From");
        fireEvent.click(screen.getByRole("button", { name: "About From address" }));
        expect(screen.getByRole("tooltip")).toHaveTextContent("use Cross-Chain Order");
    });

    it("gives every field label a help tip", async () => {
        showFullOrderView();
        await renderForm();
        openOrderSection("From");
        openOrderSection("Order Terms");
        // Memo is its own section with no label row or tip, as on every form.
        for (const name of ["About From address", "About Network", "About Receive at", "About Expiration", "About Expires"]) {
            expect(screen.getByRole("button", { name })).toBeTruthy();
        }
        // Each side's Asset and Amount carry their own tip.
        expect(screen.getAllByRole("button", { name: "About Asset" })).toHaveLength(2);
        // The coin side's label carries the unit, "Amount (BTC)".
        expect(screen.getAllByRole("button", { name: /^About Amount/ })).toHaveLength(2);
    });

    it("keeps Max inside both amount fields, live on the give side once a held token is named", async () => {
        showFullOrderView();
        await renderForm();
        const maxes = screen.getAllByRole("button", { name: /max/i });
        expect(maxes.length).toBe(2);
        await pickOrderAsset("give", "XCP", { full: true });
        await waitFor(() => expect(screen.getAllByRole("button", { name: /max/i })[0].disabled).toBe(false));
    });

    it("makes Place Order the only green action, with an icon, also in watcher mode", async () => {
        state.watcher = true;
        await renderForm();
        expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
        const place = screen.getByRole("button", { name: "Place Order" });
        expect(place.className).toContain(buttonStyles.success);
        expect(hasIcon(place)).toBe(true);
        const greens = screen.getAllByRole("button").filter((b) => b.className.includes(buttonStyles.success));
        expect(greens).toEqual([place]);
        // My Orders has its own page and nav entry; the form carries no second action.
        expect(screen.queryByRole("button", { name: "My Orders" })).toBeNull();
    });

    it("draws the allow and block lists as picker fields with icons and the expiration as a dropdown", async () => {
        await renderForm();
        openOrderSection("Order Terms");
        // Allow and block lists live in their own Lists section (operator 2026-11-13).
        openOrderSection("Lists");
        expect(screen.queryByRole("button", { name: "Set Allow-List" })).toBeNull();
        expect(hasIcon(screen.getByRole("button", { name: "Allow list: None set" }))).toBe(true);
        expect(hasIcon(screen.getByRole("button", { name: "Block list: None set" }))).toBe(true);
        // A picked list shows its name (G114); an unnamed one reads List #N.
        fireEvent.click(screen.getByRole("button", { name: "Allow list: None set" }));
        fireEvent.click(screen.getByRole("button", { name: "List row Choose Allow-List" }));
        expect(screen.getByRole("button", { name: "Allow list: Team wallets (List #7) · 4 members" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Block list: None set" }));
        fireEvent.click(screen.getByRole("button", { name: "List row Choose Block-List" }));
        expect(screen.getByRole("button", { name: "Block list: List #7 · 4 members" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Clear allow list" }));
        fireEvent.click(screen.getByRole("button", { name: "Clear block list" }));
        // G44: a choice among a few named options is the icon dropdown, not radios.
        expect(screen.queryByRole("radio", { name: "Expire at a specific time" })).toBeNull();
        expect(screen.getByRole("combobox", { name: /Expiration/ })).toBeTruthy();
        expect(screen.queryByText(/Allow\/block lists are address lists you published/)).toBeNull();
    });
});
