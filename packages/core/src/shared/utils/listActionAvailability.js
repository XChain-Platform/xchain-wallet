// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

const ACTION_PHRASES = {
    share: 'sharing lists',
    transfer: 'transferring lists',
    rename: 'renaming lists',
    union: 'creating union lists',
};

export function listActionUnavailableMessage(action) {
    const phrase = ACTION_PHRASES[action];
    return `${phrase[0].toUpperCase()}${phrase.slice(1)} isn't available in this version of the wallet yet.`;
}

export function listActionCheckFailedMessage(action) {
    return `Couldn't check whether ${ACTION_PHRASES[action]} is available right now. Reopen this page to try again.`;
}
