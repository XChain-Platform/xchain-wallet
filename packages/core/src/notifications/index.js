// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §46 notification delivery: public surface. Shells import the
// NotificationService + the getActiveAddresses helper from here, inject a
// platform-specific `notify` adapter, and host the service in their
// long-lived process (extension SW / web in-page host / Electron main).

export { NotificationService } from './NotificationService.js';
export { PriceAlertWatcher } from './PriceAlertWatcher.js';
export { GovernancePollWatcher } from './GovernancePollWatcher.js';
export { DeadlineWatcher, describeWindow } from './DeadlineWatcher.js';
export { CoinpayAutopayWatcher, pendingTxReferencesMatch } from './CoinpayAutopayWatcher.js';
export { getActiveAddresses } from './getActiveAddresses.js';
export { getBroadcastTxids, markPendingTxIndexed } from './pendingTxBridge.js';
