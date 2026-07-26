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
    permissionsToVerbs,
    bpsToPercent,
} from '../utils/contractConsentLabels.js';

/**
 * Phase F / PC-39: inline consent disclosure for the review screens of
 * every action that hands a contract authority: EXECUTE, DEPOSIT /
 * WITHDRAW, controller bind, and contract stake.
 *
 * Renders a FRAGMENT of `<dt>/<dd>` pairs (NOT a standalone block), so
 * the caller drops it straight into its existing review `<dl>` after
 * the last action-specific row (operator decision: consent shown inline
 * in the review, not as a separate stage). To inherit the caller's
 * spacing/typography it takes the same CSS-module class names the
 * caller uses for its other rows.
 *
 * Three states, driven by `manifest.status` (see contractDetail.js):
 *   - `'declared'`     → the plain-language verb list (or, for an empty
 *     allowlist, "can take no actions") plus the fee cap.
 *   - `'unrestricted'` → the contract declared no allowlist, which per
 *     DEPLOY.md means it may emit ANY action type. Stated as the
 *     unbounded permission it is, not as a missing field.
 *   - `'unavailable'`  → the wallet could not check. PC-39's trust rule:
 *     a wrong manifest at consent time is worse than none, so this state
 *     says so plainly and offers no reassurance in either direction.
 *
 * Provenance: the manifest comes from the indexer's `contract_permissions`
 * record via the explorer, which the wallet has NOT verified against the
 * chain itself. Every answered state carries that caveat inline; the
 * verified path rides PC-50 (SPV verified mode).
 *
 * @param {object} props
 * @param {import('../../flows/contractDetail.js').ContractManifest | null} props.manifest
 * @param {string} props.labelClassName   caller's `<dt>` class
 * @param {string} props.valueClassName   caller's `<dd>` class
 */
export function ContractConsentPanel({ manifest, labelClassName, valueClassName }) {
    const permissions = manifest?.permissions ?? null;
    const maxTakeBps = manifest?.maxTakeBps ?? null;
    // Older callers/hosts may still pass the pre-PC-39 two-field shape.
    // Absent status is treated as "we don't know", never as unrestricted.
    const status = manifest?.status
        ?? (Array.isArray(permissions) ? 'declared' : 'unavailable');

    const provenance = (
        <>
            <dt className={labelClassName}>Where this comes from</dt>
            <dd className={valueClassName}>
                Reported by the XChain index, not checked against the chain by
                this wallet.
            </dd>
        </>
    );

    // Could not check: say so. No verb list, no fee row, no reassurance.
    if (status === 'unavailable') {
        return (
            <>
                <dt className={labelClassName}>What this contract can do</dt>
                <dd className={valueClassName}>
                    The wallet couldn&rsquo;t look up what this contract is
                    allowed to do. Try again, or continue only if you trust the
                    author.
                </dd>
            </>
        );
    }

    const pct = bpsToPercent(maxTakeBps);
    const feeRows = (
        <>
            <dt className={labelClassName}>Max fee it can take</dt>
            <dd className={valueClassName}>
                {pct !== null
                    ? pct
                    : 'No limit of its own, so the network limit applies.'}
            </dd>
        </>
    );

    // Declared no allowlist: unrestricted by protocol rule, not "unknown".
    if (status === 'unrestricted') {
        return (
            <>
                <dt className={labelClassName}>What this contract can do</dt>
                <dd className={valueClassName}>
                    Anything. This contract set no limits on itself, so it can
                    take any action the protocol allows on your behalf. Continue
                    only if you trust the author.
                </dd>
                {feeRows}
                {provenance}
            </>
        );
    }

    const verbs = permissionsToVerbs(permissions);

    return (
        <>
            <dt className={labelClassName}>What this contract can do</dt>
            <dd className={valueClassName}>
                {verbs && verbs.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                        {verbs.map((v) => (
                            <li key={v}>It can {v}.</li>
                        ))}
                    </ul>
                ) : (
                    'Nothing: this contract declared it can take no actions on your behalf.'
                )}
            </dd>
            {feeRows}
            {provenance}
        </>
    );
}
