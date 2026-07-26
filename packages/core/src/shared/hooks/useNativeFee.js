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
// fee in the native coin" opt-in. Every quotable authoring form mounts
// the same NativeFeeToggle and must thread the SAME flag through up to
// three submit paths (legacy submit,  compose preview, watcher
// encode-only); before this hook each form re-implemented the state and
// the `|| undefined` payload normalization, and a form that forgot one
// path silently dropped the fee mode on that lane. Centralizing here
// also gives any future quoteNativeFee preview / >1% re-quote rail a
// single adoption point instead of another ~15-form sweep.

import { useState } from 'react';

/**
 * @returns {{
 *   payFeeInNativeCoin: boolean,
 *   setPayFeeInNativeCoin: (next: boolean) => void,
 *   flag: true | undefined,
 *   toggleProps: { checked: boolean, onChange: (next: boolean) => void },
 * }}
 *   `flag` is `true` or `undefined` (never `false`) so spreading
 *   `payFeeInNativeCoin: flag` into encoderOpts/extraBase leaves the
 *   payload untouched when the user did not opt in; `toggleProps`
 *   spreads onto `<NativeFeeToggle …/>` (the form still passes its own
 *   `coinTicker`, which gates rendering per chain).
 */
export function useNativeFee() {
    const [payFeeInNativeCoin, setPayFeeInNativeCoin] = useState(false);
    return {
        payFeeInNativeCoin,
        setPayFeeInNativeCoin,
        flag: payFeeInNativeCoin || undefined,
        toggleProps: { checked: payFeeInNativeCoin, onChange: setPayFeeInNativeCoin },
    };
}
