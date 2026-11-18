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
    'adsNotice.title': 'Automatic Donations',
    'adsNotice.subtitle':
        'XChain Platform includes automatic donations that support continued development.',
    'adsNotice.defaultBehavior':
        'Automatic donations are on by default. Each mainnet transaction you send adds a small donation to one queue, and when the queue is full it goes out as one donation with your next mainnet send that can cover it. The review screen shows the donation before you approve.',
    'adsNotice.optional':
        "You don't need to donate to use XChain Platform.",
    'adsNotice.settings':
        'Choose the amount, when it goes out and who receives it under Settings → Automatic Donations. Choose None to turn automatic donations off.',
};

addEnglish(messages);

export default messages;
