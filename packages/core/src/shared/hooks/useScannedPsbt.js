// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A transaction scanned off a QR, handed to Sign PSBT to seed its paste box.
// It belongs to that one visit: once the shell's view leaves Sign PSBT the
// scan is dropped, so opening Sign PSBT later from the menu starts empty
// instead of showing a transaction the user did not bring this time.

import { useEffect, useState } from 'react';

export const SIGN_PSBT_VIEW = 'sign-psbt';

/**
 * @param {string} view  the shell's current unlocked view
 * @returns {[string | null, (psbt: string | null) => void]}
 */
export function useScannedPsbt(view) {
    const [scannedPsbt, setScannedPsbt] = useState(/** @type {string | null} */ (null));
    const onSignPsbt = view === SIGN_PSBT_VIEW;
    useEffect(() => {
        if (!onSignPsbt && scannedPsbt !== null) setScannedPsbt(null);
    }, [onSignPsbt, scannedPsbt]);
    return [onSignPsbt ? scannedPsbt : null, setScannedPsbt];
}
