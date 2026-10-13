// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * State updater for a shell's token-detail ref when ManageToken reports the
 * token's on-chain issuer.
 *
 * It hands back the same object when the issuer is already recorded. The
 * shells pass ManageToken a fresh `onIssuerResolved` arrow on every render
 * and ManageToken reports from an effect keyed on that callback, so a new
 * object on every report re-renders the shell, which reports again: React's
 * "Maximum update depth exceeded" loop the click crawl hit on Manage token.
 * Returning the previous object lets React bail out after one report.
 *
 * @param {string | null | undefined} creator
 * @returns {(prev: any) => any}
 */
export function withResolvedIssuer(creator) {
    const issuer = creator || null;
    return (prev) => {
        if (!prev) return prev;
        if ((prev.issuer ?? null) === issuer) return prev;
        return { ...prev, issuer };
    };
}
