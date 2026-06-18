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
 * Phase F: inline consent disclosure for the EXECUTE / DEPOSIT /
 * WITHDRAW review screens.
 *
 * Renders a FRAGMENT of `<dt>/<dd>` pairs (NOT a standalone block), so
 * the caller drops it straight into its existing review `<dl>` after
 * the last action-specific row (operator decision: consent shown inline
 * in the review, not as a separate stage). To inherit the caller's
 * spacing/typography it takes the same CSS-module class names the
 * caller uses for its other rows.
 *
 * Three states from the (already-normalized) manifest:
 *   - permissions === null  → undeclared: a single soft-caution row
 *     ("hasn't declared what it can do… proceed only if you trust the
 *     author"). This is the absent-manifest / SDK-reader-not-yet-built
 *     case the hook degrades to.
 *   - permissions === []    → declared an empty allowlist: the contract
 *     can take no protocol actions on your behalf.
 *   - permissions: [...]    → the plain-language verb list + the fee cap.
 *
 * @param {object} props
 * @param {import('../../flows/contractDetail.js').ContractManifest | null} props.manifest
 * @param {string} props.labelClassName   caller's `<dt>` class
 * @param {string} props.valueClassName   caller's `<dd>` class
 */
export function ContractConsentPanel({ manifest, labelClassName, valueClassName }) {
    const permissions = manifest?.permissions ?? null;
    const maxTakeBps = manifest?.maxTakeBps ?? null;

    // Undeclared manifest: soft caution, no hard block.
    if (permissions === null) {
        return (
            <>
                <dt className={labelClassName}>What this contract can do</dt>
                <dd className={valueClassName}>
                    This contract hasn&rsquo;t declared what it can do. Proceed
                    only if you trust the author.
                </dd>
            </>
        );
    }

    const verbs = permissionsToVerbs(permissions);
    const pct = bpsToPercent(maxTakeBps);

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
            <dt className={labelClassName}>Max fee it can take</dt>
            <dd className={valueClassName}>
                {pct !== null ? pct : 'Not declared'}
            </dd>
        </>
    );
}
