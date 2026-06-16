// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './LayoutModeToggle.module.css';

/**
 * Settings tile in the pancake drawer that lets the user pick how
 * clicking the extension toolbar icon opens the wallet:
 *
 *   POPUP    — classic 360×600 popup hovering under the toolbar icon
 *   SIDEBAR  — Chrome MV3 side panel, persistent on the right edge
 *              while browsing dApps
 *
 * This tile only renders inside the actual Chrome extension (it
 * detects `chrome.sidePanel` + `chrome.storage.local` directly).
 * The web shell + dev preview render nothing here, so the dev
 * variant switcher remains the right tool for previewing layouts
 * outside the extension.
 *
 * Persistence + dispatch lives in the extension's background
 * service worker (`packages/extension/src/background/layoutMode.js`).
 * This component just writes the user's choice to chrome.storage;
 * the worker's storage listener applies it to the action button
 * the next time the user clicks.
 */
const STORAGE_KEY = 'xchain.layoutMode';

function isExtensionContext() {
    return typeof chrome !== 'undefined'
        && !!chrome.storage?.local
        && !!chrome.sidePanel;
}

export function LayoutModeToggle() {
    const [mode, setMode] = useState(/** @type {'popup' | 'sidepanel'} */ ('popup'));
    const [available, setAvailable] = useState(false);

    useEffect(() => {
        if (!isExtensionContext()) return;
        setAvailable(true);
        chrome.storage.local.get(STORAGE_KEY, (items) => {
            const v = items?.[STORAGE_KEY];
            if (v === 'popup' || v === 'sidepanel') setMode(v);
        });
        const onChanged = (changes, area) => {
            if (area !== 'local') return;
            const next = changes[STORAGE_KEY]?.newValue;
            if (next === 'popup' || next === 'sidepanel') setMode(next);
        };
        chrome.storage.onChanged.addListener(onChanged);
        return () => chrome.storage.onChanged.removeListener(onChanged);
    }, []);

    if (!available) return null;

    function pick(next) {
        if (next === mode) return;
        setMode(next);
        chrome.storage.local.set({ [STORAGE_KEY]: next });
    }

    return (
        <div className={styles.wrap}>
            <span className={styles.label}>Open as</span>
            <div className={styles.buttons} role="radiogroup" aria-label="Open as">
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'popup' ? 'true' : 'false'}
                    className={`${styles.btn} ${mode === 'popup' ? styles.btnActive : ''}`}
                    onClick={() => pick('popup')}
                >
                    <Icon.HomeIcon />
                    <span>Popup</span>
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'sidepanel' ? 'true' : 'false'}
                    className={`${styles.btn} ${mode === 'sidepanel' ? styles.btnActive : ''}`}
                    onClick={() => pick('sidepanel')}
                >
                    <Icon.MoreIcon />
                    <span>Sidebar</span>
                </button>
            </div>
        </div>
    );
}
