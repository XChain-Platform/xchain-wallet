// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { DEFAULT_FEE_RATE, estimateVbytes } from './testnet.js';

export const FUNDING_SATS = 500_000;
export const MIN_CLAIM_UTXO_SATS = 20_000;

function confirmedValues(view) {
    return (Array.isArray(view?.utxos) ? view.utxos : [])
        .filter((utxo) => Number(utxo?.confirmations) >= 1)
        .map((utxo) => Number(utxo?.value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a);
}

function fundingCapacity(values) {
    let held = 0;
    let needed = FUNDING_SATS + Math.ceil(estimateVbytes(1, 2) * DEFAULT_FEE_RATE);
    for (let index = 0; index < values.length; index += 1) {
        held += values[index];
        needed = FUNDING_SATS
            + Math.ceil(estimateVbytes(index + 1, 2) * DEFAULT_FEE_RATE);
        if (held >= needed) return { held, needed };
    }
    return { held, needed };
}

function refusal(subject, held, needed) {
    return new Error(
        `${subject}: held ${held} sats, needed ${needed} sats, shortfall ${needed - held} sats`,
    );
}

export async function preflightRunInput(venue, input) {
    const treasuryView = await venue.utxos(input?.address);
    const treasury = fundingCapacity(confirmedValues(treasuryView));
    if (treasury.held < treasury.needed) {
        throw refusal('Treasury preflight refused', treasury.held, treasury.needed);
    }

    const claimant = input?.claimant;
    if (typeof claimant?.wif !== 'string' || !claimant.wif.trim()
        || typeof claimant?.address !== 'string' || !claimant.address.trim()) {
        throw refusal(
            'Claimant preflight refused: run input must carry claimant fields wif and address',
            0,
            MIN_CLAIM_UTXO_SATS,
        );
    }

    const claimantView = await venue.utxos(claimant.address);
    const claimantHeld = confirmedValues(claimantView)[0] ?? 0;
    if (claimantHeld < MIN_CLAIM_UTXO_SATS) {
        throw refusal('Claimant preflight refused', claimantHeld, MIN_CLAIM_UTXO_SATS);
    }

    return {
        treasury: { held: treasury.held, needed: treasury.needed },
        claimant: { held: claimantHeld, needed: MIN_CLAIM_UTXO_SATS },
    };
}
