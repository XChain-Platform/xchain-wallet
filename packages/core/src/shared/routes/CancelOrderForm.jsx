// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The cancel-order route: the standard Cancel Order form (ORDER v1) for the
// order Order detail opened it from. The body is OrderActionRoute.

import { OrderActionRoute } from './OrderActionForms.jsx';

/**
 * @param {{ walletId: string, accountId?: string, chainId: string, actionIndex: string, onBack: () => void, onDone?: () => void }} props
 */
export function CancelOrderForm(props) {
    return <OrderActionRoute {...props} type="cancel" />;
}
