// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `adsNotice.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- shared components ---------------------------------------
    'adsNotice.title': 'Automatic Donation System',
    'adsNotice.subtitle':
        'XChain Platform includes an Automatic Donation System (ADS) that supports continued development.',
    'adsNotice.defaultBehavior':
        'ADS is on by default. It sets aside a small amount when you send a transaction and sends it as one donation once it adds up.',
    'adsNotice.optional':
        "You don't need to donate to use XChain Platform.",
    'adsNotice.settings':
        'Choose the amount and frequency under Settings → Automatic Donation System. ADS can also be turned off entirely there.',
};

addEnglish(messages);

export default messages;
