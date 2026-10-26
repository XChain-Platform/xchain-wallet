// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `signerSelect.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- signer selection ---------------------------------------
    'signerSelect.choose': 'Choose signer',
    'signerSelect.title': 'Signer',
    'signerSelect.intro':
        "Choose where this operation gets its keys. This choice doesn't share your recovery phrase or private keys.",
    'signerSelect.watcherNote':
        "Watch-only mode stays active. Choosing a key source here doesn't let this wallet sign transactions.",
};

addEnglish(messages);

export default messages;
