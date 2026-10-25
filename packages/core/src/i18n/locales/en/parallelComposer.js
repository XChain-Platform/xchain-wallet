// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `parallelComposer.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'parallelComposer.summary':
        '{actions, plural, one {# action} other {# actions}} across {networks, plural, one {# network} other {# networks}}',
    'parallelComposer.noRollback':
        "Actions on different networks aren't settled as one unit; only an individual swap completes together.",
    'parallelComposer.statusPrefix': 'Status',
    'parallelComposer.rowStatusPrefix': 'Row {row} status',
};

addEnglish(messages);

export default messages;
