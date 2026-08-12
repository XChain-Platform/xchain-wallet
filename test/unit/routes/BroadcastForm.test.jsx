// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (wallet E2E session 20, D-89 + D-90). The BROADCAST form
// packs two text fields into one protocol pair: with a feed name set, the
// message body becomes the MEMO. The wire version was picked from VALUE and
// FEE only, and MEMO exists in v1/v2/v3 but NOT in v0
// (VERSION|MESSAGE|VALUE) - so a feed name plus a body and no feed fee
// selected v0 and the body was dropped on the floor. Measured on-chain as a
// controlled pair: action 1152 "BROADCAST|0|S20FEED" with memo null against
// action 1153 "BROADCAST|2|S20FEED|1.5|MEMO-SURVIVES-TEST", identical input
// except the fee. Both were valid, both paid the protocol fee, and the
// confirm screen showed the body in neither. Its sibling lives in the
// same branch: the memo parts were joined with ' | ', and '|' is the field
// delimiter the SDK refuses, so the wallet's own timestamp checkbox made the
// action unsendable.
//
// These drive the real form to the confirm page and read the params off the
// host-side compose call, which is the exact payload that becomes the
// broadcast action.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';

// The protocol's BROADCAST format table, copied from xchain-sdk/src/formats.js
// (and identical to the indexer's own copy in
// xchain-indexer/src/actions/broadcast.js). Held here as data so the tests can
// assert the LOSSLESSNESS rule directly - every param the form emits must have
// a slot in the version it picked - rather than restating a version number.
const BROADCAST_FORMATS = {
    0: 'VERSION|MESSAGE|VALUE',
    1: 'VERSION|MESSAGE|VALUE|FEE|MEMO',
    2: 'VERSION|MESSAGE|FEE|MEMO',
    3: 'VERSION|BROADCAST_ACTION_INDEX|VALUE|MEMO',
};

// Params with no slot in the chosen format: what the encoder silently discards.
function droppedFields(params) {
    const slots = (BROADCAST_FORMATS[Number(params.VERSION)] || '').split('|');
    return Object.keys(params).filter((f) => !slots.includes(f));
}

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const LTC_CHAIN = 'litecoin-regtest';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

// The form picks the FIRST chain the host reports addresses for, so a mount on
// another chain hands it that chain alone rather than reordering a shared map.
const LTC_ADDRESSES = {
    [LTC_CHAIN]: [
        {
            id: 'addr-ltc',
            address: 'rltc1qexampleexampleexampleexampleexampleex',
            publicKey: '02cd',
            derivationPath: "m/84'/2'/0'/0/0",
            source: 'hd',
        },
    ],
};

let composeForConfirm;

function mountForm(chainId = 'bitcoin-mainnet', addresses = ADDRESSES) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        broadcastAction: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    // Anything else the form's hooks reach for (native-fee quotes, signer
    // status) answers empty rather than throwing: this suite is about the
    // params, not about what the host knows.
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(BroadcastForm, {
                walletId: 'w',
                initialChainId: chainId,
                onBack() {},
            }),
        ),
    );
}

async function fill({ feed, body, value, fee, timestamp }) {
    const feedField = await screen.findByLabelText(/^Feed name/);
    if (feed !== undefined) fireEvent.change(feedField, { target: { value: feed } });
    if (body !== undefined) {
        fireEvent.change(screen.getByLabelText(/^Message/), { target: { value: body } });
    }
    if (value !== undefined) {
        fireEvent.change(screen.getByLabelText(/^Value/), { target: { value } });
    }
    if (fee !== undefined) {
        fireEvent.change(screen.getByLabelText(/^Feed fee/), { target: { value: fee } });
    }
    if (timestamp) {
        fireEvent.click(screen.getByLabelText(/Prepend UTC timestamp/));
    }
}

function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Broadcast' }));
}

// The BROADCAST params as they reach the host-side compose.
async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params;
}

beforeEach(() => { composeForConfirm = undefined; });
afterEach(() => cleanup());

describe('BroadcastForm keeps the typed body on the wire', () => {
    it('picks a MEMO-carrying version for a feed broadcast with no feed fee', async () => {
        mountForm();
        await fill({ feed: 'S20FEED', body: 'MEMO-SURVIVES-TEST' });
        submit();

        const params = await composedParams();
        // The regression itself: this composed as v0 and the body vanished.
        expect(params.VERSION).not.toBe('0');
        expect(params.MESSAGE).toBe('S20FEED');
        expect(params.MEMO).toBe('MEMO-SURVIVES-TEST');
        expect(droppedFields(params)).toEqual([]);
        // No fee was typed, so none may be invented to buy the memo slot.
        expect(params.FEE).toBeUndefined();
    });

    it('still composes the v2 feed lane when a feed fee is typed', async () => {
        mountForm();
        await fill({ feed: 'S20FEED', body: 'MEMO-SURVIVES-TEST', fee: '1.5' });
        submit();

        const params = await composedParams();
        expect(params).toMatchObject({
            VERSION: '2', MESSAGE: 'S20FEED', FEE: '1.5', MEMO: 'MEMO-SURVIVES-TEST',
        });
        expect(droppedFields(params)).toEqual([]);
    });

    it('keeps the body alongside an oracle value with no fee', async () => {
        mountForm();
        await fill({ feed: 'S20FEED', body: 'context for the reading', value: '42' });
        submit();

        const params = await composedParams();
        // v1 is the only format carrying VALUE and MEMO together.
        expect(params).toMatchObject({
            VERSION: '1', MESSAGE: 'S20FEED', VALUE: '42', MEMO: 'context for the reading',
        });
        expect(droppedFields(params)).toEqual([]);
    });

    it('leaves a plain message on v0, where it is the MESSAGE and nothing is lost', async () => {
        mountForm();
        await fill({ body: 'hello chain' });
        submit();

        const params = await composedParams();
        expect(params).toEqual({ VERSION: '0', MESSAGE: 'hello chain' });
        expect(droppedFields(params)).toEqual([]);
    });

    it('carries the timestamp of a plain broadcast instead of dropping it', async () => {
        mountForm();
        await fill({ body: 'hello chain', timestamp: true });
        submit();

        const params = await composedParams();
        // The checkbox promises the time lands on-chain; v0 has no MEMO slot.
        expect(params.MEMO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(droppedFields(params)).toEqual([]);
    });
});

describe('BroadcastForm builds a sendable MEMO', () => {
    it('joins the timestamp and body without the field delimiter', async () => {
        mountForm();
        await fill({ feed: 'S20FEED', body: 'MEMO-SURVIVES-TEST', timestamp: true });
        submit();

        const params = await composedParams();
        // ' | ' here is what the SDK rejects with "MEMO cannot contain pipe".
        expect(params.MEMO).not.toMatch(/[|;]/);
        expect(params.MEMO).toContain('MEMO-SURVIVES-TEST');
        expect(params.MEMO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(droppedFields(params)).toEqual([]);
    });

    it('says so in plain language when the user types a delimiter, before any fee is paid', async () => {
        mountForm();
        await fill({ feed: 'S20FEED', body: 'a | b' });
        submit();

        await screen.findByText(/Remove any \| or ; characters/);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});

// (wallet E2E session 25, D-114). BROADCAST has no gas-schedule entry:
// `/RLTC/api/feequote?action=BROADCAST` answers `xchainFee 0.00000000`,
// `requiredFeeSats 0`, and applyNativeFeePreflight builds no fee output for it.
// The SCREEN said otherwise. On LTC, where a later change turns the fee row into a
// statement rather than a choice, this form read "Protocol fee is paid in LTC ·
// LTC is the only way to pay the protocol fee on this chain. The fee is sent
// on-chain and is not refunded if the network rejects this transaction" for an
// action that is never charged anything.
describe('the fee row does not promise a fee BROADCAST never pays', () => {
    it('states the chain rule conditionally on LTC instead of asserting a charge', async () => {
        mountForm(LTC_CHAIN, LTC_ADDRESSES);
        await screen.findByLabelText(/^Feed name/);

        // The old sentences, both gone: no definite charge, no forfeiture claim
        // about money that is never spent.
        expect(screen.queryByText(/Protocol fee is paid in LTC/)).toBeNull();
        expect(screen.queryByText(/The fee is sent on-chain and is not refunded/)).toBeNull();

        // What replaces them is true whether or not this action is priced, so
        // no per-action list has to be kept in the client for it to stay true.
        expect(screen.getByText('Protocol fees are paid in LTC')).toBeTruthy();
        expect(screen.getByText(/If this action charges one/)).toBeTruthy();
    });
});
