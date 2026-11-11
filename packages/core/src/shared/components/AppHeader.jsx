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
import { isNativeShell } from '../nativeShell.js';
import styles from './AppHeader.module.css';
import { t } from '../../i18n/index.js';

function supportsPopOut() {
    if (typeof window === 'undefined' || isNativeShell() || globalThis.xchainWalletWindow) return false;
    const protocol = window.location?.protocol;
    return protocol === 'http:'
        || protocol === 'https:'
        || (protocol === 'chrome-extension:' && Number(window.innerWidth) <= 600);
}

function automaticPopOut() {
    const protocol = window.location?.protocol;
    if (protocol === 'chrome-extension:' && Number(window.innerWidth) <= 600) {
        const createTab = globalThis.chrome?.tabs?.create;
        if (typeof createTab !== 'function') return null;
        return async () => {
            try {
                await createTab({ url: window.location.href });
                window.close?.();
            } catch {
                // The popup stays open when the browser rejects tab creation.
            }
        };
    }
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return () => window.open(window.location.href, '_blank', 'noopener,noreferrer');
}

/**
 * @param {object} props
 * @param {() => void} [props.onMenuToggle]
 * @param {boolean} [props.menuOpen]
 * @param {() => void} [props.onLock]
 * @param {boolean} [props.locking]
 * @param {boolean} [props.isWatcherMode]
 * @param {{ id: string, name: string } | null} [props.activeWallet]
 * @param {() => void} [props.onPopOut]
 */
export function AppHeader({
    onMenuToggle,
    menuOpen = false,
    onLock,
    locking,
    isWatcherMode = false,
    activeWallet = null,
    onPopOut,
}) {
    const navSurface = useContext(NavSurfaceContext);
    const showLock = Boolean(onLock) && navSurface !== 'sidebar';
    const popOut = supportsPopOut()
        ? (typeof onPopOut === 'function' ? onPopOut : automaticPopOut())
        : null;

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
                {activeWallet ? (
                    <span className={styles.walletName} title={activeWallet.name}>
                        {activeWallet.name}
                    </span>
                ) : null}
                <WatchOnlyBadge visible={isWatcherMode} />
            </div>
            <div className={styles.right}>
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
                {popOut ? (
                    <Button
                        variant="secondary"
                        icon={<Icon.ExternalLinkIcon />}
                        onClick={popOut}
                        aria-label={t('history.detail.openNewWindow')}
                        title={t('history.detail.openNewWindow')}
                        data-header-control
                    />
                ) : null}
                <HeaderActionMenu onMenuToggle={onMenuToggle} menuOpen={menuOpen} />
            </div>
        </div>
    );
}
