// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop update banner (row 142).
//
// WHY THIS EXISTS. The desktop shell has had a complete update pipeline for
// weeks - a signed feed, per-arch channel pointers, a K1-signed release
// manifest and the S5 gate that verifies a download against it before
// anything is installed - and no way for a user to reach any of it. Main
// broadcast `xchain:updater` into a channel no renderer could subscribe to
// under contextIsolation, and `downloadAndInstall()`, the only code path that
// ever calls `quitAndInstall`, had no caller in the repo. The app checked for
// updates on launch, told nobody, and installed nothing. This component and
// the `xchainWalletUpdater` preload bridge are the missing last mile.
//
// IT RENDERS NO REMOTE STRING, for the same reason UpdateNoticeBanner does
// not: a banner inside a wallet that prints text chosen by whoever controls
// the feed is a phishing surface wearing our branding. The only feed-derived
// value shown is the version, and only after it parses as a plain semver;
// every other sentence here is a constant in this file. Refusal reasons are
// deliberately NOT printed either. They can quote feed-derived detail, and
// "this update was refused" plus a pointer to the verification page is the
// honest, unspoofable version of that message.
//
// DISMISSAL IS PER SESSION and not persisted, matching UpdateNoticeBanner: a
// persisted dismissal has to remember WHICH version was dismissed, and
// getting that wrong silences the next one too.

import { useCallback, useEffect, useRef, useState } from 'react';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const WRAP = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    fontSize: 'var(--xc-text-sm)',
    color: 'var(--xc-text)',
};

const LINK_BUTTON = {
    background: 'none',
    border: 'none',
    color: 'var(--xc-text-muted)',
    cursor: 'pointer',
    fontSize: 'var(--xc-text-sm)',
};

/**
 * @returns {{ onEvent: (cb: (e: any) => void) => () => void, install: (action?: string) => Promise<any> } | null}
 */
function updaterBridge() {
    const bridge = typeof window === 'undefined' ? null : window.xchainWalletUpdater;
    return bridge && typeof bridge.onEvent === 'function' ? bridge : null;
}

export function DesktopUpdateBanner() {
    // 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'verifying' | 'ready' | 'restart-blocked' | 'install-failed' | 'error'
    const [state, setState] = useState('idle');
    const [version, setVersion] = useState(/** @type {string | null} */ (null));
    const [progress, setProgress] = useState(/** @type {number | null} */ (null));
    const [dismissed, setDismissed] = useState(false);
    // Why a verified update failed to install: 'read-only' | 'permission' | null.
    // Main sends one of a fixed set of words and anything else is ignored.
    const [installCause, setInstallCause] = useState(/** @type {string | null} */ (null));
    const operationInProgress = useRef(/** @type {null | 'check' | 'download' | 'restart'} */ (null));
    const retryAction = useRef(/** @type {'check' | 'download' | 'restart'} */ ('check'));

    useEffect(() => {
        const bridge = updaterBridge();
        // Every other shell reaches this file through the shared renderer
        // bundle in dev; without the bridge there is nothing to subscribe
        // to and nothing to show.
        if (!bridge) return undefined;

        const applyEvent = (event, retained = false) => {
            const type = event?.type;
            if (type === 'checking') {
                if (!event?.userInitiated || retained) return;
                operationInProgress.current = 'check';
                setState('checking');
                setDismissed(false);
                return;
            }
            if (type === 'not-available') {
                if (!event?.userInitiated || retained) return;
                operationInProgress.current = null;
                setState('current');
                return;
            }
            if (type === 'available') {
                const next = String(event?.info?.version ?? '');
                operationInProgress.current = null;
                setVersion(SEMVER.test(next) ? next : null);
                setState('available');
                setDismissed(false);
                return;
            }
            if (type === 'progress') {
                const percent = Number(event?.info?.percent);
                setProgress(Number.isFinite(percent) ? Math.round(Math.min(100, Math.max(0, percent))) : null);
                setState('downloading');
                return;
            }
            if (type === 'downloaded' || type === 'verifying') {
                setState('verifying');
                return;
            }
            if (type === 'ready') {
                operationInProgress.current = null;
                setState('ready');
                setDismissed(false);
                return;
            }
            if (type === 'rejected') {
                operationInProgress.current = null;
                retryAction.current = 'download';
                setState('error');
                return;
            }
            if (type === 'error' && event?.userInitiated && !retained) {
                const failedOperation = operationInProgress.current;
                operationInProgress.current = null;
                retryAction.current = failedOperation === 'download' ? 'download' : 'check';
                setState('error');
            }
        };

        // Main starts the launch check before creating a renderer. Hydrate
        // durable update work, while a quiet launch-check error stays silent.
        let cancelled = false;
        let liveEventSeen = false;
        if (typeof bridge.getState === 'function') {
            Promise.resolve(bridge.getState()).then((event) => {
                if (!cancelled && !liveEventSeen) applyEvent(event, true);
            }).catch(() => { /* no offer to show */ });
        }

        const unsubscribe = bridge.onEvent((event) => {
            liveEventSeen = true;
            applyEvent(event);
        });

        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, []);

    const runAction = useCallback((action) => {
        const bridge = updaterBridge();
        if (!bridge || operationInProgress.current) return;
        operationInProgress.current = action;
        retryAction.current = action;
        setDismissed(false);
        if (action === 'check') setState('checking');
        if (action === 'download') {
            setProgress(null);
            setState('downloading');
        }
        bridge.install(action)
            .then((result) => {
                operationInProgress.current = null;
                if (result?.ok) return;
                if (action === 'restart') {
                    const cause = result?.cause;
                    if (cause === 'read-only' || cause === 'permission') {
                        setInstallCause(cause);
                        setState('install-failed');
                        return;
                    }
                    setInstallCause(null);
                    if (result?.retryable) {
                        setState('restart-blocked');
                        return;
                    }
                }
                setState('error');
            })
            .catch(() => {
                operationInProgress.current = null;
                setState('error');
            });
    }, []);

    if (dismissed || state === 'idle') return null;

    return (
        <div role="status" aria-live="polite" style={WRAP}>
            <span aria-hidden="true">⬆</span>
            <div style={{ flex: 1 }}>
                {state === 'checking' ? 'Checking for updates...' : null}
                {state === 'current' ? 'XChain Wallet is up to date.' : null}
                {state === 'available' ? (
                    version
                        ? `Version ${version} is available.`
                        : 'A newer version is available.'
                ) : null}
                {state === 'downloading' ? (
                    progress == null ? 'Downloading update...' : `Downloading update... ${progress}%`
                ) : null}
                {state === 'verifying' ? 'Verifying the downloaded update...' : null}
                {state === 'ready' ? 'Update is ready to restart.' : null}
                {state === 'restart-blocked' ? (
                    'Finish the current wallet operation before restarting.'
                ) : null}
                {state === 'install-failed' ? (
                    installCause === 'read-only'
                        ? 'The update was verified but could not be installed because XChain Wallet is '
                          + 'running from a read-only location. Move the app to your Applications or '
                          + 'programs folder, open it from there, and try again.'
                        : 'The update was verified but could not be installed because this account '
                          + 'does not have permission to replace the app. Run it from a location you '
                          + 'can write to, or ask an administrator, and try again.'
                ) : null}
                {state === 'error' && retryAction.current === 'check' ? (
                    'Could not check for updates. Check your connection and try again.'
                ) : null}
                {state === 'error' && retryAction.current !== 'check' ? (
                    'This update could not be downloaded or verified, so it was not installed. '
                    + 'Your wallet is untouched. Check docs.xchain.io for how to verify a release by hand.'
                ) : null}
            </div>
            {state === 'available' ? (
                <button type="button" onClick={() => runAction('download')} style={LINK_BUTTON}>
                    Download update
                </button>
            ) : null}
            {state === 'ready' || state === 'restart-blocked' ? (
                <button type="button" onClick={() => runAction('restart')} style={LINK_BUTTON}>
                    Restart to update
                </button>
            ) : null}
            {state === 'install-failed' && installCause !== 'read-only' ? (
                <button type="button" onClick={() => runAction('restart')} style={LINK_BUTTON}>
                    Retry
                </button>
            ) : null}
            {state === 'error' ? (
                <button type="button" onClick={() => runAction(retryAction.current)} style={LINK_BUTTON}>
                    Retry
                </button>
            ) : null}
            {['checking', 'downloading', 'verifying'].includes(state) ? null : (
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss update notice"
                    style={LINK_BUTTON}
                >
                    Dismiss
                </button>
            )}
        </div>
    );
}
