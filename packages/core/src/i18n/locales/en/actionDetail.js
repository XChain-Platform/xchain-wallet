// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `actionDetail.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- action routes -------------------------------------------
    'actionDetail.back': 'Back to history',
    'actionDetail.title': 'Action',
    'actionDetail.empty.title': 'No action selected',
    'actionDetail.empty.body': 'Action details appear here after one is selected.',
    'actionDetail.offline':
        'You are offline. Showing saved action details. Network actions will be available when your connection returns.',
};

addEnglish(messages);

export default messages;
