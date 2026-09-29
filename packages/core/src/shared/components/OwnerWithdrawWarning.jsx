// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { OWNER_WITHDRAW_WARNING } from '../routes/contractResponseShape.js';
import styles from './OwnerWithdrawWarning.module.css';

/**
 * The owner-withdraw warning (OWNER_WITHDRAW_OPT_IN): shown on a contract's
 * details and on the forms that send tokens into it, when the explorer says
 * the deployer can still WITHDRAW the contract's custody. Renders nothing for
 * false (consensus refuses the withdrawal) and for null (an explorer that does
 * not serve the field), so an unknown answer never produces a warning.
 *
 * @param {object} props
 * @param {boolean | null} props.ownerWithdraw   contractOwnerWithdraw(row)
 */
export function OwnerWithdrawWarning({ ownerWithdraw }) {
    if (ownerWithdraw !== true) return null;
    return (
        <div role="note" className={styles.warningBanner} data-testid="owner-withdraw-warning">
            <strong className={styles.headline}>Deployer can withdraw</strong>
            <p className={styles.detail}>
                {OWNER_WITHDRAW_WARNING} Only send tokens here if you trust the deployer.
            </p>
        </div>
    );
}
