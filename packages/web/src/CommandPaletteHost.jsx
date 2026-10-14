// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The command palette and its command catalogue, loaded on demand. Neither is
// needed to paint the lock screen or Home, so App renders this module only
// once the palette has been opened and keeps both out of the startup bundle.

import { CommandPalette } from '@xchain-wallet/core/shared/commandPalette/CommandPalette.jsx';
import {
    balancesToCommands,
    buildCommands,
    contactsToCommands,
    helpToCommands,
    parseFreeformCommands,
    settingsSectionsToCommands,
    sitesToCommands,
} from '@xchain-wallet/core/shared/commandPalette/commandRegistry.js';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object} props.ctx catalogue context for buildCommands
 * @param {object} props.entityCtx handlers for token, site, settings and help rows
 * @param {any[]} props.tokenRows
 * @param {any[]} props.contacts
 * @param {any[]} props.sites
 * @param {(view: string) => void} props.navigate
 * @param {object} props.parseCtx context for free-form queries such as "send 100 MYTOKEN"
 */
export function CommandPaletteHost({
    open, onClose, ctx, entityCtx, tokenRows, contacts, sites, navigate, parseCtx,
}) {
    const commands = [
        ...buildCommands(ctx),
        ...balancesToCommands(tokenRows, entityCtx),
        ...contactsToCommands(contacts, { navigate }),
        ...sitesToCommands(sites, entityCtx),
        ...settingsSectionsToCommands(entityCtx),
        ...helpToCommands(entityCtx),
    ];
    const parseQuery = (q) => parseFreeformCommands(q, parseCtx);
    return (
        <CommandPalette
            open={open}
            onClose={onClose}
            commands={commands}
            parseQuery={parseQuery}
        />
    );
}
