// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `manageToken.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'manageToken.sellName.priceTooLarge':
        'Price is too large. The network takes at most {digits} digits before the decimal point.',
    'manageToken.sellName.priceAboveSupply': 'Price can\'t be more than the {supply} {tick} that can ever exist.',
    'manageToken.officialProjectNoun':
        '{count, plural, one {project.} other {projects.}}',
    'manageToken.subassetCount':
        '{count, plural, one {Subasset (#)} other {Subassets (#)}}',
};

addEnglish(messages);

export default messages;
