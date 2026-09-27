// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-148: the pay-to-buy panel told every buyer that "Any LTC wallet can trigger
// a fill", including on dispensers that refuse most of them.
//
// A dispenser may carry an ALLOW_LIST or a BLOCK_LIST, checked in
// `xchain-indexer/src/actions/dispense.js` against the payer. The gate runs
// AFTER the coin has moved, because a dispenser is triggered by a BARE coin
// payment with no XChain action of its own - so a buyer the list refuses does
// not get a rejection, they get a `DISPENSE` recorded
// `invalid: DESTINATION (dispenser allow list)` and no refund.
//
// MEASURED on Litecoin regtest 2026-07-30, driving the lane end to end
// (test/e2e/tests/dispensers/allow-list-gate.regtest.spec.js): two identical
// 0.05 LTC payments to one dispenser, differing only in who sent them. The
// listed buyer was credited 25 XCHAIN; the unlisted buyer was refused and was
// down **5,005,460 sats** - the trigger price plus the miner fee - holding
// nothing. The panel had read neither list field, though the explorer serves
// both on the row it was already reading and the OWNER's own view of the same
// page prints them.
//
// These drive the real component, because the defect was a sentence the panel
// rendered unconditionally rather than a calculation.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'litecoin-mainnet';
const BUYER = 'ltc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';
const OTHER_BUYER = 'ltc1qotherbuyerbuyerbuyerbuyerbuyerbuyer';
const OWNER = 'ltc1qownerownerownerownerownerownerownerow';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1', address: BUYER, publicKey: '02ab',
        derivationPath: "m/84'/2'/0'/0/0", source: 'hd',
    }],
};

/** An ordinary coin-priced dispenser owned by somebody else. */
const OPEN_DISPENSER = {
    action_index: '1700',
    source: OWNER,
    address: OWNER,
    give_tick: 'XCHAIN',
    give_amount: '25',
    get_tick: null,
    get_coin: 'LTC',
    get_amount: '0.05',
    fiat: null,
    fiat_amount: null,
    oracle_address: null,
    allow_list: null,
    block_list: null,
    escrow_remaining: '100',
    status: 'open',
    current_status: 'open',
};

const ALLOW_GATED = { ...OPEN_DISPENSER, action_index: '1701', allow_list: '1690' };
const BLOCK_GATED = { ...OPEN_DISPENSER, action_index: '1702', block_list: '1691' };
const BOTH_GATED = { ...OPEN_DISPENSER, action_index: '1703', allow_list: '1690', block_list: '1691' };
const TOKEN_PAID = {
    ...OPEN_DISPENSER,
    action_index: '1704',
    get_tick: 'PAY',
    get_coin: null,
};

const REMOVED_LISTS = { ...OPEN_DISPENSER, action_index: '1704', allow_list: '0', block_list: 0 };

function mount(dispenser, {
    addresses = ADDRESSES,
    lists = {},
    tokenInfo = {},
    getListByActionIndex,
} = {}) {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: (addresses[CHAIN] || []).map((address) => ({
                address: address.address,
                balances: {
                    native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'PAY', quantity: '100000000', divisibility: 8 }],
                },
            })),
        }),
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|PAY', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        getTokenInfo: vi.fn().mockImplementation(({ tick }) => Promise.resolve(tokenInfo[tick] || {})),
        getListByActionIndex: getListByActionIndex || vi.fn().mockImplementation(
            ({ actionIndex: index }) => Promise.resolve(lists[index] || { list: [] }),
        ),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w', chainId: CHAIN, actionIndex: dispenser.action_index,
                onBack() {}, onCanceled() {},
            }),
        ),
    );
    return messaging;
}

function list(current, created = current) {
    return {
        list: created,
        state: { edit_resolution_active: true, current_list: current },
    };
}

function buyButton() {
    return screen.getByRole('button', { name: 'Buy 1 fill' });
}

async function expectSelectedPayerRefused() {
    expect(await screen.findByText(/selected paying address is not allowed/i)).toBeInTheDocument();
    expect(buyButton()).toBeDisabled();
}

afterEach(() => cleanup());

describe('restricted dispenser, buyer view (D-148)', () => {
    it('stops claiming any wallet can trigger a gated dispenser', async () => {
        mount(ALLOW_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(/Any LTC wallet can trigger a fill/.test(text),
            'the panel tells a buyer any wallet can trigger a dispenser that will refuse most of '
            + `them, and the refused payment is not returned: ${text.slice(0, 400)}`)
            .toBe(false);
    });

    it('names the allow-list, and says a refused payment is not returned', async () => {
        mount(ALLOW_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text, 'the buyer is not told the dispenser is restricted at all')
            .toMatch(/restricted/i);
        expect(text, 'the buyer cannot see WHICH list decides whether their payment works')
            .toMatch(/list #1690/);
        // The money sentence. Without it "restricted" reads like a rejection
        // the buyer walks away from, which is exactly what it is not.
        expect(text, 'the buyer is not told the coin is spent either way')
            .toMatch(/not returned/i);
    });

    it('names a block-list the same way', async () => {
        mount(BLOCK_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/restricted/i);
        expect(text, 'a block-list gates in the OPPOSITE direction and must be described as such')
            .toMatch(/barred/i);
        expect(text).toMatch(/list #1691/);
    });

    it('describes both lists when a dispenser carries both', async () => {
        mount(BOTH_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/list #1690/);
        expect(text).toMatch(/list #1691/);
    });

    it('leaves the ungated case exactly as it was', async () => {
        // The control, and it matters: most dispensers carry no list, and
        // warning about a restriction that does not exist would teach buyers to
        // ignore the warning that does.
        mount(OPEN_DISPENSER);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/Any LTC wallet can trigger a fill/);
        expect(text, 'an unrestricted dispenser must not be described as restricted')
            .not.toMatch(/restricted/i);
        expect(text).toMatch(/Send exactly/);
    });

    it('uses the current edited membership for the selected payer', async () => {
        mount(ALLOW_GATED, {
            lists: {
                1690: list([OWNER], [BUYER, OWNER]),
            },
        });
        await expectSelectedPayerRefused();
    });

    it('enforces the dispenser block-list for the selected payer', async () => {
        mount(BLOCK_GATED, {
            lists: { 1691: list([BUYER]) },
        });
        await expectSelectedPayerRefused();
    });

    it('does not let an eligible sibling address authorize the selected payer', async () => {
        const addresses = {
            [CHAIN]: [
                ADDRESSES[CHAIN][0],
                {
                    ...ADDRESSES[CHAIN][0],
                    id: 'addr-2',
                    address: OTHER_BUYER,
                    derivationPath: "m/84'/2'/0'/0/1",
                },
            ],
        };
        mount(ALLOW_GATED, {
            addresses,
            lists: { 1690: list([BUYER, OWNER]) },
        });
        await screen.findByLabelText(/Pay from/i);
        fireEvent.change(screen.getByLabelText(/Pay from/i), { target: { value: 'addr-2' } });
        await expectSelectedPayerRefused();
    });

    it.each([
        ['payment-token allow-list', 'pay-allow', [OWNER]],
        ['payment-token block-list', 'pay-block', [BUYER]],
        ['dispensed-token allow-list', 'give-allow', [OWNER]],
        ['dispensed-token block-list', 'give-block', [BUYER]],
    ])('enforces the %s', async (_name, barredList, members) => {
        mount(TOKEN_PAID, {
            tokenInfo: {
                PAY: { allowList: 'pay-allow', blockList: 'pay-block' },
                XCHAIN: { allowList: 'give-allow', blockList: 'give-block' },
            },
            lists: {
                'pay-allow': list(barredList === 'pay-allow' ? members : [BUYER, OWNER]),
                'pay-block': list(barredList === 'pay-block' ? members : []),
                'give-allow': list(barredList === 'give-allow' ? members : [BUYER, OWNER]),
                'give-block': list(barredList === 'give-block' ? members : []),
            },
        });
        await expectSelectedPayerRefused();
    });

    it('allows the buy only when payer and pay-to pass all six list gates', async () => {
        mount({ ...TOKEN_PAID, allow_list: '1690', block_list: '1691' }, {
            tokenInfo: {
                PAY: { allowList: 'pay-allow', blockList: 'pay-block' },
                XCHAIN: { allowList: 'give-allow', blockList: 'give-block' },
            },
            lists: {
                1690: list([BUYER, OWNER]),
                1691: list([]),
                'pay-allow': list([BUYER, OWNER]),
                'pay-block': list([]),
                'give-allow': list([BUYER, OWNER]),
                'give-block': list([]),
            },
        });
        await waitFor(() => expect(buyButton()).toBeEnabled());
        expect(document.body.textContent).not.toMatch(/selected paying address is not allowed/i);
    });

    it('refreshes membership before opening the signing review', async () => {
        let reads = 0;
        const getListByActionIndex = vi.fn().mockImplementation(() => {
            reads += 1;
            return Promise.resolve(list(reads === 1 ? [BUYER, OWNER] : [OWNER]));
        });
        const messaging = mount(ALLOW_GATED, { getListByActionIndex });
        await waitFor(() => expect(buyButton()).toBeEnabled());
        fireEvent.click(buyButton());
        await expectSelectedPayerRefused();
        expect(screen.queryByTestId('confirm-approve')).not.toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('refreshes membership again before signing', async () => {
        let reads = 0;
        const getListByActionIndex = vi.fn().mockImplementation(() => {
            reads += 1;
            return Promise.resolve(list(reads < 3 ? [BUYER, OWNER] : [OWNER]));
        });
        const messaging = mount(ALLOW_GATED, { getListByActionIndex });
        await waitFor(() => expect(buyButton()).toBeEnabled());
        fireEvent.click(buyButton());
        const password = await screen.findByLabelText(/Password/i);
        fireEvent.change(password, { target: { value: 'secret' } });
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(await screen.findByText(/refused by a current access list/i)).toBeInTheDocument();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('reads zero list sentinels as none', async () => {
        mount(REMOVED_LISTS);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).not.toMatch(/list #0/i);
        expect(text).not.toMatch(/restricted/i);
        expect(text).toMatch(/Allow listnone/);
        expect(text).toMatch(/Block listnone/);
    });
});
