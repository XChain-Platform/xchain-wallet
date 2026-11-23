// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `alerts.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'alerts.title': 'Notifications',

    // --- alerts --------------------------------------------------
    'alerts.empty.title': 'No notifications',
    'alerts.empty.body': 'Wallet activity, security, and price changes appear here.',
    'alerts.markAllRead': 'Mark all read',
    'alerts.unread': 'Unread',
    'alerts.search': 'Search notifications',
    'alerts.filter': 'Filter notifications',
    'alerts.filterType': 'Notification type',
    'alerts.filterTypeHelp': 'Shows only the notifications you tick: unread ones, or one or more kinds such as payments or security.',
    'alerts.matches': '{count} notifications match',
    'alerts.paymentDue.autoPayCannotSign': "Auto Pay can't sign this address. Tap to pay.",
    'alerts.type.all': 'All types',
    'alerts.type.payments': 'Payments',
    'alerts.type.messages': 'Messages',
    'alerts.type.security': 'Security',
};

addEnglish(messages);

export const alertsAutopayCannotSign = messages['alerts.paymentDue.autoPayCannotSign'];
export default messages;
