// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import styles from './LayoutModeToggle.module.css';
import { useToast } from './ToastHost.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import { LAYOUT_MODE_STORAGE_KEY } from '../utils/layoutModeStorageKey.js';

/**
 * Settings tile in the pancake drawer that lets the user pick how
 * clicking the extension toolbar icon opens the wallet:
 *
 *   POPUP   - classic 360×600 popup hovering under the toolbar icon
 *   SIDEBAR - Chrome MV3 side panel, persistent on the right edge
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

function isExtensionContext() {
    return typeof chrome !== 'undefined'
        && !!chrome.storage?.local
        && !!chrome.sidePanel;
}

export function LayoutModeToggle() {
    const [mode, setMode] = useState(/** @type {'popup' | 'sidepanel'} */ ('popup'));
    const [available, setAvailable] = useState(false);
    const persistedModeRef = useRef(/** @type {'popup' | 'sidepanel'} */ ('popup'));
    const writeVersionRef = useRef(0);
    const { showToast } = useToast();
    const groupId = useId();
    const labelId = `${groupId}-label`;
    const descriptionId = `${groupId}-description`;

    useEffect(() => {
        if (!isExtensionContext()) return;
        let active = true;
        let storageChanged = false;
        setAvailable(true);
        const onChanged = (changes, area) => {
            if (area !== 'local') return;
            if (!Object.prototype.hasOwnProperty.call(changes, LAYOUT_MODE_STORAGE_KEY)) return;
            storageChanged = true;
            const next = changes[LAYOUT_MODE_STORAGE_KEY]?.newValue;
            if (active && (next === 'popup' || next === 'sidepanel')) {
                writeVersionRef.current += 1;
                persistedModeRef.current = next;
                setMode(next);
            }
        };
        chrome.storage.onChanged.addListener(onChanged);
        chrome.storage.local.get(LAYOUT_MODE_STORAGE_KEY, (items) => {
            if (!active || storageChanged) return;
            const v = items?.[LAYOUT_MODE_STORAGE_KEY];
            if (v === 'popup' || v === 'sidepanel') {
                persistedModeRef.current = v;
                setMode(v);
            }
        });
        return () => {
            active = false;
            chrome.storage.onChanged.removeListener(onChanged);
        };
    }, []);

    if (!available) return null;

    function pick(next) {
        if (next === mode) return;
        const writeVersion = writeVersionRef.current + 1;
        writeVersionRef.current = writeVersion;
        setMode(next);

        const failWrite = () => {
            if (writeVersionRef.current === writeVersion) setMode(persistedModeRef.current);
            showToast({
                id: 'layout-mode-save-failed',
                variant: 'error',
                message: t('components.layoutModeToggle.saveFailed'),
            });
        };

        try {
            const pending = chrome.storage.local.set({ [LAYOUT_MODE_STORAGE_KEY]: next });
            if (typeof pending?.then === 'function') {
                void Promise.resolve(pending).then(() => {
                    if (writeVersionRef.current === writeVersion) persistedModeRef.current = next;
                }, failWrite);
            } else {
                persistedModeRef.current = next;
            }
        } catch {
            // Extension reloads can invalidate the storage context between render and click.
            failWrite();
        }
    }

    return (
        <div className={styles.wrap}>
            <span id={labelId} className={styles.label}>{t('components.layoutModeToggle.openAs')}</span>
            <span id={descriptionId} className={styles.description}>
                {t('components.layoutModeToggle.chooseHowTheWalletOpens')}
            </span>
            <div
                className={styles.buttons}
                role="radiogroup"
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
            >
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'popup'}
                    className={`${styles.btn} ${mode === 'popup' ? styles.btnActive : ''}`}
                    onClick={() => pick('popup')}
                >
                    <Icon.HomeIcon />
                    <span>{t('components.layoutModeToggle.popup')}</span>
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'sidepanel'}
                    className={`${styles.btn} ${mode === 'sidepanel' ? styles.btnActive : ''}`}
                    onClick={() => pick('sidepanel')}
                >
                    <Icon.MoreIcon />
                    <span>{t('components.layoutModeToggle.sidebar')}</span>
                </button>
            </div>
        </div>
    );
}
