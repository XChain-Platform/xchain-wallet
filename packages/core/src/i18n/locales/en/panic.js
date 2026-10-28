// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `panic.*` keys: what each surface says while a
// self-armed panic-mode freeze refuses signing. Every module that renders one
// of these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    'panic.send.title': "Panic mode is on. This send can't be signed.",
    'panic.send.detail':
        'Signing stays frozen for another {remaining}. You can fill in the form, but approving it will be refused. Turn panic mode off in Settings > Safety to send now.',
    // A sign surface whose only way forward is the control named by {reject}.
    'panic.rejectOnly.detail':
        '{remaining} remaining. Nothing can be signed or sent here until panic mode is turned off in the wallet. {reject} closes this request.',
    // A sign surface that has no labelled reject control: the way out is Back.
    'panic.rejectOnly.detailBack':
        '{remaining} remaining. Nothing can be signed or sent here until panic mode is turned off in the wallet. Go back to leave this screen.',
    // One title for every surface that says the freeze is on.
    'panic.frozen.title': 'Panic mode is on. Signing is frozen.',
    'panic.sign.detail':
        '{remaining} remaining. Approving will be refused until panic mode is turned off in Settings > Safety.',
    'panic.home.detail':
        'Nothing can be sent or signed for another {remaining}. Balances and history still work. Turn it off in Settings > Safety.',
    'panic.refusal':
        'Panic mode is on, so nothing was sent. Signing stays frozen for another {remaining}. Turn panic mode off in Settings > Safety to continue.',
};

addEnglish(messages);

export default messages;
