// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, Icon } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/walletMenu.js';

/**
 * Opens the wallet menu owned by the shell command palette.
 *
 * @param {object} props
 * @param {() => void} [props.onMenuToggle]
 * @param {boolean} [props.menuOpen]
 */
export function HeaderActionMenu({ onMenuToggle, menuOpen = false }) {
    return (
        <Button
            variant="secondary"
            icon={<Icon.MenuIcon />}
            onClick={onMenuToggle}
            aria-label={t('walletMenu.openMenu')}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            title={t('walletMenu.openMenu')}
            data-header-control
        />
    );
}
