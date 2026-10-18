// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    TESTNET_ADDRESS_RE,
    assertTreasuryKey,
    buildTreasuryFunding,
    waitForFundingConfirmed,
} from './testnet.js';
import { FUNDING_SATS } from './testnet_preflight.js';

export async function fundTestnetAddress(
    venue,
    treasury,
    destination,
    { sendSats = FUNDING_SATS, timeoutMs, sleep, now, wallet } = {},
) {
    if (typeof destination !== 'string' || !TESTNET_ADDRESS_RE.test(destination)) {
        throw new Error('a valid Bitcoin testnet destination is required; refusing to fund');
    }

    const signer = wallet;
    assertTreasuryKey(treasury, signer);
    const view = await venue.utxos(treasury.address);
    const tx = buildTreasuryFunding({
        treasury,
        utxos: Array.isArray(view?.utxos) ? view.utxos : [],
        destination,
        sendSats,
        wallet: signer,
    });
    const result = await venue.broadcast(tx.txHex);
    const txid = result?.txid || tx.txid;
    await waitForFundingConfirmed(venue, destination, txid, { timeoutMs, sleep, now });
    return txid;
}
