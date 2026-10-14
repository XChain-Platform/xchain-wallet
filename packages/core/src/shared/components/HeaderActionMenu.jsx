// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@xchain-wallet/core/ui';
import { useBackHandler } from '../../ui/backStack.js';
import { isNativeShell } from '../nativeShell.js';
import PLATFORM_LINKS from '../platform-links.json';
import styles from './AppHeader.module.css';

function actionableItems(menu) {
    return Array.from(menu?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || []);
}

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
 * Header overflow menu. The header keeps only global status, lock, and this
 * trigger visible while secondary actions remain labelled, keyboard reachable rows.
 */
export function HeaderActionMenu({
    settingsControl,
    onCommandPalette,
    onScan,
    onManageAddresses,
    onViewAddress,
    onPopOut,
    onMore,
    platformCurrent,
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const initialFocusRef = useRef('first');

    const close = (restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.querySelector('button')?.focus();
    };
    useBackHandler(open ? () => close(true) : undefined);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (!wrapRef.current?.contains(event.target)) close();
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close(true);
        };
        const onFocusIn = (event) => {
            if (event.target.closest?.('#xc-main')) close();
        };
        window.addEventListener('mousedown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('focusin', onFocusIn);
        return () => {
            window.removeEventListener('mousedown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('focusin', onFocusIn);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const items = actionableItems(menuRef.current);
        const item = initialFocusRef.current === 'last' ? items.at(-1) : items[0];
        item?.focus();
    }, [open]);

    const invoke = (handler) => {
        close();
        handler();
    };
    const platformLinks = platformCurrent
        ? PLATFORM_LINKS.links.filter((site) => site.key !== platformCurrent)
        : [];
    const popOut = supportsPopOut()
        ? (typeof onPopOut === 'function' ? onPopOut : automaticPopOut())
        : null;
    const settings = isValidElement(settingsControl)
        ? cloneElement(settingsControl, { onNavigate: close })
        : settingsControl;
    const rows = [
        { id: 'search', label: 'Search', Icon: Icon.SearchIcon, handler: onCommandPalette, shortcut: 'Cmd/Ctrl+K' },
        { id: 'scan', label: 'Scan', Icon: Icon.ScanIcon, handler: onScan },
        { id: 'manage-addresses', label: 'Manage addresses', Icon: Icon.AddressIcon, handler: onManageAddresses },
        { id: 'view-address', label: 'View address', Icon: Icon.EyeIcon, handler: onViewAddress },
        { id: 'pop-out', label: 'Open in new window', Icon: Icon.ExternalLinkIcon, handler: popOut },
        { id: 'more', label: 'More wallet actions', Icon: Icon.MoreIcon, handler: onMore },
    ].filter((row) => typeof row.handler === 'function');

    return (
        <div ref={wrapRef} className={styles.actionWrap}>
            <span ref={triggerRef} className={styles.actionTrigger}>
                <Button
                    variant="secondary"
                    icon={<Icon.MenuIcon />}
                    onClick={() => {
                        initialFocusRef.current = 'first';
                        setOpen((value) => !value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                        event.preventDefault();
                        initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
                        setOpen(true);
                    }}
                    aria-label="Open menu"
                    aria-haspopup="menu"
                    aria-expanded={open ? 'true' : 'false'}
                    title="Open menu"
                    data-header-control
                />
            </span>
            {open ? (
                <div
                    ref={menuRef}
                    className={styles.actionMenu}
                    role="menu"
                    aria-label="Header actions"
                    onKeyDown={(event) => {
                        if (!event.target.closest?.('[role="menuitem"]')) return;
                        // Tab leaves the menu, so it closes without trapping focus.
                        if (event.key === 'Tab') {
                            close();
                            return;
                        }
                        const items = actionableItems(menuRef.current);
                        const index = items.indexOf(document.activeElement);
                        if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
                            event.preventDefault();
                            items[index].click();
                            return;
                        }
                        let nextIndex = null;
                        if (event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
                        if (event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
                        if (event.key === 'Home') nextIndex = 0;
                        if (event.key === 'End') nextIndex = items.length - 1;
                        if (nextIndex === null || items.length === 0) return;
                        event.preventDefault();
                        items[nextIndex]?.focus();
                    }}
                >
                    {settings}
                    {rows.map(({ id, label, Icon: RowIcon, handler, shortcut }) => (
                        <button
                            key={id}
                            type="button"
                            role="menuitem"
                            className={styles.actionRow}
                            onClick={() => invoke(handler)}
                            aria-keyshortcuts={id === 'search' ? 'Meta+K Control+K' : undefined}
                        >
                            <span className={styles.rowIcon} aria-hidden="true"><RowIcon /></span>
                            <span className={styles.rowLabel}>{label}</span>
                            {shortcut ? <span className={styles.shortcut} aria-hidden="true">{shortcut}</span> : null}
                        </button>
                    ))}
                    {platformLinks.map((site) => (
                        <a
                            key={site.key}
                            role="menuitem"
                            className={styles.actionRow}
                            href={site.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => close()}
                        >
                            <span className={styles.rowIcon} aria-hidden="true"><Icon.ExternalLinkIcon /></span>
                            <span className={styles.rowLabel}>{site.label}</span>
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
