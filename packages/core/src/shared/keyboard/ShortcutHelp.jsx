// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §34.3 shortcut-help modal. Opened by `?` or Cmd/Ctrl+/ (see
// useKeyboardShortcuts). Renders the effective (default + user-override)
// bindings grouped by section, so it is always in sync with what the
// dispatcher actually binds. Rebinding itself lives in Settings → Keyboard;
// the footer points there.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../ui/index.js';
import { SHORTCUT_GROUPS, formatBinding, resolveBindings } from './shortcuts.js';
import styles from './ShortcutHelp.module.css';
import { useBackHandler } from '../../ui/backStack.js';
import { useFocusTrap } from '../utils/focusTrap.js';

function isMac() {
    if (typeof navigator === 'undefined') return false;
    const p = navigator.platform || navigator.userAgent || '';
    return /mac|iphone|ipad|ipod/i.test(p);
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {Record<string, string>} [props.overrides]  settings.keyboard.bindings (§34.1)
 */
export function ShortcutHelp({ open, onClose, overrides }) {
    const shortcuts = useMemo(() => resolveBindings(overrides), [overrides]);
    const [extensionCommands, setExtensionCommands] = useState([]);
    // The system Back gesture closes this before it leaves the screen.
    useBackHandler(open ? onClose : undefined);
    // Opened by a bare key, so focus starts on the page: move it into the
    // dialog, keep Tab inside it, and hand it back to the opener on close.
    const dialogRef = useRef(null);
    useFocusTrap(dialogRef, { active: open });
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);
    useEffect(() => {
        if (!open || typeof chrome === 'undefined' || !chrome.commands?.getAll) return undefined;
        let active = true;
        chrome.commands.getAll((commands) => {
            if (!active) return;
            setExtensionCommands((Array.isArray(commands) ? commands : []).filter(
                (command) => command?.name && command?.description,
            ));
        });
        return () => { active = false; };
    }, [open]);

    if (!open) return null;
    const mac = isMac();

    return (
        <div
            ref={dialogRef}
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onMouseDown={onClose}
        >
            <div className={styles.panel} role="presentation" onMouseDown={(e) => e.stopPropagation()}>
                <header className={styles.header}>
                    <span className={styles.title}>Keyboard shortcuts</span>
                    <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                        <Icon.XIcon />
                    </button>
                </header>
                <div className={styles.body} role="region" aria-label="Shortcut list" tabIndex={0}>
                    {SHORTCUT_GROUPS.map((group) => (
                        <section key={group} className={styles.group}>
                            <h2 className={styles.groupTitle}>{group}</h2>
                            <dl className={styles.list}>
                                {shortcuts.filter((s) => s.group === group).map((s) => (
                                    <div key={s.id} className={styles.row}>
                                        <dt className={styles.label}>{s.label}</dt>
                                        <dd className={styles.keys}>
                                            <kbd className={styles.kbd}>{formatBinding(s.binding, mac)}</kbd>
                                            {s.altBinding ? (
                                                <>
                                                    <span className={styles.or}>or</span>
                                                    <kbd className={styles.kbd}>{formatBinding(s.altBinding, mac)}</kbd>
                                                </>
                                            ) : null}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                    {extensionCommands.length > 0 ? (
                        <section className={styles.group}>
                            <h2 className={styles.groupTitle}>Browser extension</h2>
                            <dl className={styles.list}>
                                {extensionCommands.map((command) => (
                                    <div key={command.name} className={styles.row}>
                                        <dt className={styles.label}>{command.description}</dt>
                                        <dd className={styles.keys}>
                                            <kbd className={styles.kbd}>{command.shortcut || 'Not set'}</kbd>
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ) : null}
                    <p className={styles.footerNote}>
                        Rebind wallet shortcuts in Settings → Keyboard.
                        {extensionCommands.length > 0
                            ? ' Manage browser extension shortcuts in your browser.'
                            : null}
                    </p>
                </div>
            </div>
        </div>
    );
}
