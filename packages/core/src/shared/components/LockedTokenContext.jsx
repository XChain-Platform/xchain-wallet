// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { registry as registryLib } from '@xchain-wallet/core';
import { TickerIcon } from './TickerIcon.jsx';
import styles from './LockedTokenContext.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Read-only display used by the owner-action forms (MintForm,
 * DestroyForm, TokenAdminForm, DispenserForm, DividendForm,
 * AirdropForm, BroadcastForm) when they're launched from ManageToken
 * with a specific (chainId, tick) already chosen.
 *
 * Replaces the form's editable ticker input + chain picker with a
 * single chip that shows the token icon, its ticker, and the chain
 * it's on — so the user can't accidentally retype, and the form's
 * "this action operates on token X" intent is reinforced visually.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick
 * @param {string} [props.label]    optional header above the chip (e.g. "Token")
 */
export function LockedTokenContext({ chainId, tick, label = 'Token' }) {
    const descriptor = chainRegistry.get(chainId);
    return (
        <div className={styles.wrap}>
            {label ? <span className={styles.label}>{label}</span> : null}
            <div className={styles.chip}>
                <TickerIcon chainId={chainId} tick={tick} size={32} />
                <div className={styles.text}>
                    <span className={styles.tick}>{tick}</span>
                    {descriptor ? (
                        <span className={styles.chain}>
                            on {descriptor.displayName || chainId}
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
