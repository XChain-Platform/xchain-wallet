// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../i18n/index.js';

// platform-links.json is generated elsewhere and carries English labels only,
// so each known site key resolves its visible name through the dictionary. A
// key the wallet has not met yet falls back to the generated label rather
// than rendering blank.
const LABELS = {
    main: () => t('shell.platformLinks.main'),
    wallet: () => t('settings.thisWallet.wallet'),
    explorer: () => t('receive.explorer'),
    docs: () => t('shell.platformLinks.docs'),
    encoder: () => t('shell.platformLinks.encoder'),
    sync: () => t('shell.platformLinks.sync'),
    hub: () => t('shell.platformLinks.hub'),
    mcp: () => t('shell.platformLinks.mcp'),
};

/**
 * Visible name of one platform site in the active locale.
 *
 * @param {{ key: string, label: string }} site
 * @returns {string}
 */
export function platformLinkLabel(site) {
    const resolve = LABELS[site.key];
    return resolve ? resolve() : site.label;
}
