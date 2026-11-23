// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useState } from 'react';
import { Notice } from '@xchain-wallet/core/ui';
import { t } from '../../../core/src/i18n/index.js';
import '../../../core/src/i18n/locales/en/pwaInstall.js';
import styles from './PwaInstall.module.css';

export const IOS_INSTALL_HINT_DISMISSED_KEY = 'xc:pwa:ios-install-hint-dismissed';

export function isStandalone(browserWindow = globalThis.window) {
    if (!browserWindow) return false;
    return browserWindow.navigator?.standalone === true
        || browserWindow.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function iosInstallBrowser(browserWindow = globalThis.window) {
    const navigator = browserWindow?.navigator;
    if (!navigator) return null;
    const userAgent = navigator.userAgent || '';
    const iosDevice = /iPad|iPhone|iPod/i.test(userAgent)
        || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
    if (!iosDevice) return null;
    if (/CriOS\//i.test(userAgent)) return 'chrome';
    if (/Version\/[\d.]+.*Safari\//i.test(userAgent)) return 'safari';
    return null;
}

function readIosHintDismissed(browserWindow) {
    try {
        return browserWindow?.localStorage?.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) === '1';
    } catch (_err) {
        return false;
    }
}

/**
 * Keeps the browser-owned install offer intact until the user presses the
 * wallet menu action. Chromium decides whether the site is installable, so
 * the action cannot appear from user-agent guessing alone.
 */
export function usePwaInstall(browserWindow = globalThis.window) {
    const [installPrompt, setInstallPrompt] = useState(null);
    const [standalone, setStandalone] = useState(() => isStandalone(browserWindow));
    const [iosHintDismissed, setIosHintDismissed] = useState(
        () => readIosHintDismissed(browserWindow),
    );

    useEffect(() => {
        if (!browserWindow) return undefined;
        const displayMode = browserWindow.matchMedia?.('(display-mode: standalone)');
        const syncStandalone = () => {
            const installed = isStandalone(browserWindow);
            setStandalone(installed);
            if (installed) setInstallPrompt(null);
        };
        const captureInstallPrompt = (event) => {
            if (isStandalone(browserWindow)) return;
            event.preventDefault();
            setInstallPrompt(event);
        };
        const markInstalled = () => {
            setInstallPrompt(null);
            setStandalone(true);
        };

        browserWindow.addEventListener('beforeinstallprompt', captureInstallPrompt);
        browserWindow.addEventListener('appinstalled', markInstalled);
        displayMode?.addEventListener?.('change', syncStandalone);
        return () => {
            browserWindow.removeEventListener('beforeinstallprompt', captureInstallPrompt);
            browserWindow.removeEventListener('appinstalled', markInstalled);
            displayMode?.removeEventListener?.('change', syncStandalone);
        };
    }, [browserWindow]);

    const install = useCallback(() => {
        if (!installPrompt || standalone) return Promise.resolve(null);
        setInstallPrompt(null);
        return Promise.resolve(installPrompt.prompt()).catch(() => null);
    }, [installPrompt, standalone]);

    const dismissIosHint = useCallback(() => {
        setIosHintDismissed(true);
        try {
            browserWindow?.localStorage?.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, '1');
        } catch (_err) { /* private-mode Safari */ }
    }, [browserWindow]);

    const iosBrowser = iosInstallBrowser(browserWindow);
    return {
        install: installPrompt && !standalone ? install : undefined,
        standalone,
        iosBrowser,
        showIosHint: iosBrowser !== null && !standalone && !iosHintDismissed,
        dismissIosHint,
    };
}

export function IosInstallHint({ show, currentView, browser, onDismiss }) {
    if (!show || currentView !== 'home') return null;
    return (
        <div className={styles.banner} data-ios-install-hint="">
            <Notice
                tone="info"
                flush
                title={t('pwaInstall.iosTitle')}
                onDismiss={onDismiss}
                dismissLabel={t('pwaInstall.dismissIosHint')}
            >
                {t(browser === 'chrome' ? 'pwaInstall.iosChromeSteps' : 'pwaInstall.iosSafariSteps')}
            </Notice>
        </div>
    );
}
