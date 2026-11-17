// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import * as branding from '../../branding/branding.js';
import { Button, Icon } from '../../ui/index.js';
import { HeaderActionMenu } from './HeaderActionMenu.jsx';
import styles from './AppHeader.module.css';
import { t } from '../../i18n/index.js';

// The app bar holds only the logo, the bell and the menu.

/**
 * @param {object} props
 * @param {() => void} [props.onMenuToggle]
 * @param {boolean} [props.menuOpen]
 * @param {() => void} [props.onNotifications]  renders the Notifications bell
 * @param {number} [props.notificationsUnread]  unread count the bell's badge shows
 * @param {number} [props.notificationsActionRequired]  how many of the unread items need the user to act (turns the bell red)
 * @param {boolean} [props.showMenu]  false hides the menu button on a boot-state page, where the wallet menu needs a vault that is not open
 */
export function AppHeader({
    onMenuToggle,
    menuOpen = false,
    onNotifications,
    notificationsUnread = 0,
    notificationsActionRequired = 0,
    showMenu = true,
}) {
    const unread = Math.max(0, Number(notificationsUnread) || 0);
    const action = Math.min(unread, Math.max(0, Number(notificationsActionRequired) || 0));
    // The button itself never changes colour; only the count bubble does:
    // blue while the unread items are ordinary, red once one needs the user to act.
    let bellLabel = t('shell.header.notifications');
    if (action > 0) bellLabel = t('shell.header.notificationsAction', { count: unread, action });
    else if (unread > 0) bellLabel = t('shell.header.notificationsUnread', { count: unread });

    return (
        <div
            className={styles.bar}
            role="region"
            aria-label={t('shell.header.appHeader')}
        >
            <div className={styles.left}>
                <img
                    src={branding.logoUrl()}
                    alt={branding.PRODUCT_NAME}
                    className={styles.logo}
                />
            </div>
            <div className={styles.right}>
                {typeof onNotifications === 'function' ? (
                    <span className={styles.bellWrap}>
                        <Button
                            variant="secondary"
                            icon={<Icon.BellIcon />}
                            onClick={onNotifications}
                            aria-label={bellLabel}
                            title={bellLabel}
                            data-header-control
                            data-unread={unread > 0 ? String(unread) : undefined}
                            data-bell-tone={unread > 0 ? (action > 0 ? 'action' : 'info') : 'none'}
                        />
                        {unread > 0 ? (
                            <span
                                className={action > 0 ? `${styles.bellBadge} ${styles.bellBadgeAction}` : styles.bellBadge}
                                aria-hidden="true"
                            >{unread > 99 ? '99+' : unread}</span>
                        ) : null}
                    </span>
                ) : null}
                {showMenu ? <HeaderActionMenu onMenuToggle={onMenuToggle} menuOpen={menuOpen} /> : null}
            </div>
        </div>
    );
}
