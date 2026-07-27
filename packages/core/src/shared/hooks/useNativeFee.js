// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useNativeFee (PC-51): the one place a form keeps its "pay the protocol
// fee in the native coin" setting. Every quotable authoring form mounts
// the same NativeFeeToggle and must thread the SAME flag through up to
// three submit paths (legacy submit,  compose preview, watcher
// encode-only); before this hook each form re-implemented the state and
// the `|| undefined` payload normalization, and a form that forgot one
// path silently dropped the fee mode on that lane. Centralizing here
// also gives any future quoteNativeFee preview / >1% re-quote rail a
// single adoption point instead of another ~15-form sweep.
//
// : the setting is only an OPT-IN on Bitcoin. Everywhere else the
// native-coin output IS the protocol fee (registry/nativeFee.js carries the
// consensus rule), so on those chains this hook forces the flag on and the
// toggle becomes a statement rather than a choice. Before that, every
// fee-bearing action composed on LTC/DOGE from the default state indexed
// `invalid: insufficient fee (native coin output required)` after paying a
// real miner fee. Passing the chain in is what makes the default correct, so
// a caller that omits it keeps Bitcoin's opt-in behavior.

import { useState } from 'react';
import { isNativeFeeMandatory } from '../../registry/nativeFee.js';

/**
 * @param {{ coin?: string } | string | null | undefined} [chainOrCoin]
 *   the chain the action will be submitted on: a descriptor, a chain id
 *   ('litecoin-regtest'), a coin id ('litecoin'), or a ticker ('LTC').
 * @returns {{
 *   payFeeInNativeCoin: boolean,
 *   setPayFeeInNativeCoin: (next: boolean) => void,
 *   mandatory: boolean,
 *   flag: true | undefined,
 *   toggleProps: { checked: boolean, onChange: (next: boolean) => void, mandatory: boolean },
 * }}
 *   `flag` is `true` or `undefined` (never `false`) so spreading
 *   `payFeeInNativeCoin: flag` into encoderOpts/extraBase leaves the
 *   payload untouched when the fee is not paid natively; `toggleProps`
 *   spreads onto the NativeFeeToggle (the form still passes its own
 *   `coinTicker`, which gates rendering per chain).
 */
export function useNativeFee(chainOrCoin) {
    const [optIn, setOptIn] = useState(false);
    // Derived per render, not seeded into useState: the chain is usually
    // unknown on the first render (the descriptor resolves once the chain
    // picker settles) and the user can switch chains mid-form, while a state
    // initializer runs once and never again. Deriving keeps the flag tracking
    // the chain instead of whatever it was at mount.
    const mandatory = isNativeFeeMandatory(chainOrCoin);
    const payFeeInNativeCoin = mandatory || optIn;
    return {
        payFeeInNativeCoin,
        // Still accepted while mandatory, and still ignored: the derived value
        // wins, so no caller can switch the only available fee mode back off.
        setPayFeeInNativeCoin: setOptIn,
        mandatory,
        flag: payFeeInNativeCoin || undefined,
        toggleProps: { checked: payFeeInNativeCoin, onChange: setOptIn, mandatory },
    };
}
