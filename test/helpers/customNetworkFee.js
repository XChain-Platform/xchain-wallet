// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, screen } from '@testing-library/react';

import { customFeeEstimate } from '../../packages/core/src/flows/feeEstimate.js';
import { defaultRegistry } from '../../packages/core/src/registry/index.js';

// Speed and Fees has one custom fee editor, the Network fee line (G113):
// sliding to Custom opens that line's exact-fee input, and the typed fee is
// turned into a rate for the form. A test that wants a form to compose at a
// given rate types the fee that rate prices to, so the rate the form sees is
// the one the test names.

const NETWORK_FEE_EDITOR = /^Network fee amount/;

/**
 * The exact network fee a custom rate prices to on a chain, in coin units,
 * at the size the wallet's fee estimates assume.
 *
 * @param {number | string} rate in the chain's displayed unit (sat/vB, DOGE/kB)
 * @param {string} [chainId]
 * @returns {string}
 */
export function feeForRate(rate, chainId = 'bitcoin-mainnet') {
    const estimate = customFeeEstimate({ chainId, chainRegistry: defaultRegistry(), rate });
    if (!estimate) throw new Error(`no custom fee for rate ${rate} on ${chainId}`);
    return estimate.coinAmount;
}

// Label queries, not role queries: they reach the fee controls whether or not
// the test opened the Speed and Fees section, and they never wait, so a test
// on fake timers can use them.
const TEXT_INPUT = 'input[type="text"]';

/** The open Network fee line editor. */
export function networkFeeEditor(queries = screen) {
    return queries.getByLabelText(NETWORK_FEE_EDITOR, { selector: TEXT_INPUT });
}

/** The Network fee line editor, or null while it is closed. */
export function queryNetworkFeeEditor(queries = screen) {
    return queries.queryByLabelText(NETWORK_FEE_EDITOR, { selector: TEXT_INPUT });
}

/**
 * The Network fee line editor, opened with its Edit control when it is
 * closed (after a remount, or once a valid fee was blurred).
 */
export function openNetworkFeeEditor(queries = screen) {
    const open = queryNetworkFeeEditor(queries);
    if (open) return open;
    fireEvent.click(queries.getByLabelText('Edit exact fee amount', { selector: 'button' }));
    return networkFeeEditor(queries);
}

/**
 * Slide the Speed and Fees slider to Custom, which opens the Network fee
 * line editor, and return that editor.
 */
export async function slideToCustomFee(queries = screen) {
    const sliderQuery = ['Network fee', { selector: 'input[type="range"]' }];
    // Waits only when the tiers have not drawn the slider yet.
    const slider = queries.queryByLabelText(...sliderQuery) ?? await queries.findByLabelText(...sliderQuery);
    fireEvent.change(slider, { target: { value: String(slider.max || 3) } });
    return networkFeeEditor(queries);
}

/**
 * Slide to Custom and type an exact network fee into the one editor.
 *
 * @param {string} fee coin units, typed as is
 */
export async function typeCustomFee(fee, queries = screen) {
    const editor = await slideToCustomFee(queries);
    fireEvent.change(editor, { target: { value: fee } });
    return editor;
}

/**
 * Slide to Custom and type the fee a positive rate prices to; any other
 * text (empty, zero, negative, not a number) is typed as is.
 *
 * @param {string} rate
 * @param {{ chainId?: string, queries?: object }} [opts]
 */
export async function typeCustomRate(rate, { chainId = 'bitcoin-mainnet', queries = screen } = {}) {
    const n = Number(rate);
    const text = String(rate).trim() !== '' && Number.isFinite(n) && n > 0 ? feeForRate(rate, chainId) : String(rate);
    return typeCustomFee(text, queries);
}
