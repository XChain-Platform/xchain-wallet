// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { FormNotice } from '@xchain-wallet/core/ui';
import { OWNER_WITHDRAW_WARNING } from '../routes/contractResponseShape.js';
import { t } from '../../i18n/index.js';

/**
 * The owner-withdraw warning (OWNER_WITHDRAW_OPT_IN): shown on a contract's
 * details and on the forms that send tokens into it, when the explorer says
 * the deployer can still WITHDRAW the contract's custody. Renders nothing for
 * false (consensus refuses the withdrawal) and for null (an explorer that does
 * not serve the field), so an unknown answer never produces a warning. On a
 * form it is one of the form's notices, above the form card.
 *
 * @param {object} props
 * @param {boolean | null} props.ownerWithdraw   contractOwnerWithdraw(row)
 */
export function OwnerWithdrawWarning({ ownerWithdraw }) {
    if (ownerWithdraw !== true) return null;
    return (
        <FormNotice
            variant="warning"
            role="note"
            testId="owner-withdraw-warning"
            lead={t('components.ownerWithdrawWarning.deployerCanWithdraw')}
        >
            {`${OWNER_WITHDRAW_WARNING} ${t('components.ownerWithdrawWarning.onlySendTokensHereIf')}`}
        </FormNotice>
    );
}
