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
    'alerts.title': 'Alerts',
    'alerts.close': 'Close alerts',
    'alerts.empty': 'No alerts. Wallet activity, security, and price changes appear here.',

    // --- alerts --------------------------------------------------
    'alerts.empty.title': 'No alerts',
    'alerts.empty.body': 'Wallet activity, security, and price changes appear here.',
    'alerts.unreadCount': '{count} unread',
    'alerts.markAllRead': 'Mark all read',
    'alerts.unread': 'Unread',
    'alerts.search': 'Search alerts',
    'alerts.clearSearch': 'Clear search',
    'alerts.filterType': 'Filter alert type',
    'alerts.matches': '{count} alerts match',
    'alerts.type.all': 'All types',
    'alerts.type.payments': 'Payments',
    'alerts.type.messages': 'Messages',
    'alerts.type.security': 'Security',
};

addEnglish(messages);

export default messages;
