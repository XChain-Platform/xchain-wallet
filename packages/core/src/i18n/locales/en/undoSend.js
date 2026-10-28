// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `undoSend.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'undoSend.toast.sendingInS': 'Sending in {remaining} s',
    'undoSend.toast.sendCancelled': 'Send cancelled',
    // The countdown and outcome of a held send whose Send screen is gone.
    'undoSend.handoff.sendingInS': 'Your send goes out in {remaining} s.',
    'undoSend.handoff.sent': 'Your held send is broadcast. It shows in History.',
    'undoSend.handoff.cancelled': 'Send cancelled. Nothing was broadcast.',
    'undoSend.handoff.failed': 'Your held send did not finish. Check History before you send it again.',
};

addEnglish(messages);

export default messages;
