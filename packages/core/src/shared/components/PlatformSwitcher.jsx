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

/**
 * @param {object} props
 * @param {string} [props.current]  this surface's key in the link list (e.g. 'wallet').
 *        The matching entry renders as a marked, non-interactive row. Omit to
 *        render nothing at all.
 */
export function PlatformSwitcher({ current }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    // Same dismissal contract as the header's other dropdowns: outside click
    // or Escape.
    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e) => {
            if (wrapRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!current) return null;

    const links = Array.isArray(LINKS?.links) ? LINKS.links : [];
    if (links.length === 0) return null;

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                type="button"
                className={styles.trigger}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open ? 'true' : 'false'}
                aria-label="XChain platform sites"
                title="XChain platform sites"
            >
                <Icon.ExternalLinkIcon />
            </button>
            {open ? (
                <div className={styles.menu} role="menu" aria-label="XChain platform sites">
                    {links.map((p) => (p.key === current ? (
                        <div key={p.key} className={styles.here} aria-current="page">
                            <span>{p.label}</span>
                            <span className={styles.hereTag}>you are here</span>
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
                            onClick={() => setOpen(false)}
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
