// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect } from 'react';

/**
 * Tell the shell whether this onboarding lane holds the screen for its own
 * first-wallet write: while the write runs and while the lane shows what
 * follows it, until the lane hands control back itself.
 *
 * The extension passes a guard because the background announces every unlock
 * to every open surface, the writing window included; with the hold reported,
 * that announcement does not move the window to Home under the lane. Shells
 * that pass no guard are unaffected.
 *
 * @param {{ report: (holding: boolean) => void } | null | undefined} guard
 * @param {boolean} holding
 */
export function useOwnWalletWriteHold(guard, holding) {
    const report = guard?.report;
    useEffect(() => {
        if (typeof report !== 'function') return undefined;
        report(holding === true);
        return () => report(false);
    }, [report, holding]);
}
