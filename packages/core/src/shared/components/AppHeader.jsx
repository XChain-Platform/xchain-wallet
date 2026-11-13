// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useContext } from 'react';
import * as branding from '../../branding/branding.js';
import { Button, Icon } from '../../ui/index.js';
import { HeaderActionMenu } from './HeaderActionMenu.jsx';
import { WatchOnlyBadge } from './WatchOnlyBadge.jsx';
import { NavSurfaceContext } from './navSurface.js';
import styles from './AppHeader.module.css';
import { t } from '../../i18n/index.js';

// Open in new window is a wallet menu row (G03), not a header button; the
// header holds only the logo, the bell and the menu.

/**
 * @param {object} props
 * @param {() => void} [props.onMenuToggle]
 * @param {boolean} [props.menuOpen]
 * @param {() => void} [props.onLock]
 * @param {() => void} [props.onNotifications]  renders the Notifications bell in Lock's place; Lock stays in the menu
 * @param {number} [props.notificationsUnread]  unread count the bell's badge shows
 * @param {boolean} [props.locking]
 * @param {boolean} [props.isWatcherMode]
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 */
export function AppHeader({
    onMenuToggle,
    menuOpen = false,
    onLock,
    onNotifications,
    notificationsUnread = 0,
    locking,
    isWatcherMode = false,
    activeWallet = null,
}) {
    const navSurface = useContext(NavSurfaceContext);
    // The Notifications bell takes Lock's place on every surface; Lock stays
    // one tap away in the menu (and the sidebar's own Lock row).
    const showLock = Boolean(onLock) && navSurface !== 'sidebar' && typeof onNotifications !== 'function';
    const unread = Math.max(0, Number(notificationsUnread) || 0);
    const bellLabel = unread > 0 ? t('shell.header.notificationsUnread', { count: unread }) : t('shell.header.notifications');

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
                <WatchOnlyBadge visible={isWatcherMode} />
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
                            className={unread > 0 ? styles.bellUnread : undefined}
                        />
                        {unread > 0 ? <span className={styles.bellBadge} aria-hidden="true">{unread > 99 ? '99+' : unread}</span> : null}
                    </span>
                ) : null}
                {showLock ? (
                    <Button
                        variant="secondary"
                        icon={<Icon.LockIcon />}
                        onClick={onLock}
                        disabled={locking}
                        aria-label={t('home.lockWallet')}
                        title={t('home.lockWallet')}
                        data-header-control
                    />
                ) : null}
                <HeaderActionMenu onMenuToggle={onMenuToggle} menuOpen={menuOpen} />
            </div>
        </div>
    );
}
