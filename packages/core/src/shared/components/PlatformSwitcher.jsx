// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PlatformSwitcher: cross-site navigation for the *.xchain.io family
// (main site, explorer, docs, encoder status, bootstraps, validator hub).
// The wallet is one surface of a platform whose other surfaces live on
// sibling hosts, and until this existed there was no route to any of them.
//
// THE LIST IS NOT MAINTAINED HERE. It is generated in xchain-websites from
// PLATFORM_LINKS and published at https://xchain.io/assets/platform-links.json;
// ../platform-links.json is a VENDORED COPY. To add or rename a host, change
// it there, rebuild, and re-copy. That repo's CI cannot see this one, which is
// why the copy is paired with test/smoke/shells/platform-links-drift.smoke.js:
// it fetches the published file and compares.
//
// Opt-in by design: it renders only where the host passes `current`. The web
// shell does; the extension popup and desktop app do not, because a menu of
// websites is not what a user opens their wallet extension to find.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/index.js';
import LINKS from '../platform-links.json';
import styles from './PlatformSwitcher.module.css';
import { useBackHandler } from '../../ui/backStack.js';

function actionableMenuItems(menu) {
    return Array.from(
        menu?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || [],
    );
}

/**
 * @param {object} props
 * @param {string} [props.current]  this surface's key in the link list (e.g. 'wallet').
 *        The matching entry renders as a marked, non-interactive row. Omit to
 *        render nothing at all.
 */
export function PlatformSwitcher({ current }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const triggerRef = useRef(null);
    // The system Back gesture and Escape close this before it leaves the
    // screen; the shared stack consumes Escape, so focus goes back here.
    useBackHandler(open ? () => { setOpen(false); triggerRef.current?.focus(); } : undefined);
    const menuRef = useRef(null);
    const initialFocusRef = useRef('first');

    const openMenu = (initialFocus = 'first') => {
        initialFocusRef.current = initialFocus;
        setOpen(true);
    };

    const closeMenu = (restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
    };

    // Same dismissal contract as the header's other dropdowns: outside click
    // or Escape.
    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const items = actionableMenuItems(menuRef.current);
        const item = initialFocusRef.current === 'last' ? items[items.length - 1] : items[0];
        item?.focus();
    }, [open]);

    if (!current) return null;

    const links = Array.isArray(LINKS?.links) ? LINKS.links : [];
    if (links.length === 0) return null;

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                ref={triggerRef}
                type="button"
                className={styles.trigger}
                onClick={() => {
                    if (open) closeMenu();
                    else openMenu();
                }}
                onKeyDown={(e) => {
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                    e.preventDefault();
                    openMenu(e.key === 'ArrowUp' ? 'last' : 'first');
                }}
                aria-haspopup="menu"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="XChain platform sites"
                title="XChain platform sites"
            >
                <Icon.ExternalLinkIcon />
            </button>
            {open ? (
                <div
                    ref={menuRef}
                    className={styles.menu}
                    role="menu"
                    aria-label="XChain platform sites"
                    onKeyDown={(e) => {
                        const items = actionableMenuItems(menuRef.current);
                        const index = items.indexOf(document.activeElement);
                        let nextIndex = null;
                        if (e.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
                        if (e.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
                        if (e.key === 'Home') nextIndex = 0;
                        if (e.key === 'End') nextIndex = items.length - 1;
                        if (nextIndex === null || items.length === 0) return;
                        e.preventDefault();
                        items[nextIndex]?.focus();
                    }}
                >
                    {links.map((p) => (p.key === current ? (
                        <div
                            key={p.key}
                            className={styles.here}
                            role="menuitem"
                            aria-current="page"
                            aria-disabled="true"
                            aria-label={`${p.label}, current site`}
                        >
                            <span>{p.label}</span>
                            <span className={styles.hereTag} aria-hidden="true">you are here</span>
                        </div>
                    ) : (
                        // Each entry leaves the wallet, so it opens in a new
                        // tab: navigating the wallet itself away mid-session is
                        // a good way to lose an unsent transaction.
                        <a
                            key={p.key}
                            role="menuitem"
                            className={styles.item}
                            href={p.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            tabIndex={-1}
                            onClick={() => closeMenu()}
                        >
                            <span>{p.label}</span>
                            <span className={styles.itemIcon} aria-hidden="true">
                                <Icon.ExternalLinkIcon />
                            </span>
                        </a>
                    )))}
                </div>
            ) : null}
        </div>
    );
}
