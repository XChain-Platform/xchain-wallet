// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop update banner ( row 142).
//
// WHY THIS EXISTS. The desktop shell has had a complete update pipeline for
// weeks - a signed feed, per-arch channel pointers, a K1-signed release
// manifest and the  S5 gate that verifies a download against it before
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

import { useCallback, useEffect, useState } from 'react';

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
 * @returns {{ onEvent: (cb: (e: any) => void) => () => void, install: () => Promise<any> } | null}
 */
function updaterBridge() {
    const bridge = typeof window === 'undefined' ? null : window.xchainWalletUpdater;
    return bridge && typeof bridge.onEvent === 'function' ? bridge : null;
}

export function DesktopUpdateBanner() {
    // 'idle' | 'available' | 'installing' | 'refused'
    const [state, setState] = useState('idle');
    const [version, setVersion] = useState(/** @type {string | null} */ (null));
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const bridge = updaterBridge();
        // Every other shell reaches this file through the shared renderer
        // bundle in dev; without the bridge there is nothing to subscribe
        // to and nothing to show.
        if (!bridge) return undefined;

        // ASK FIRST, THEN LISTEN ( row 148).
        //
        // Subscribing was never enough. Main checks the feed at launch and
        // this component only exists in the unlocked branch of the app, so
        // on any install with a vault the `available` broadcast happens
        // while the user is still at the Locked screen and no listener is
        // alive to hear it. Measured on a packaged 0.338.1 build against a
        // staging feed serving 0.339.0: main logged `Found version 0.339.0`
        // and the banner, mounted afterwards, showed nothing.
        //
        // Only `available` is hydrated. The retained state can also be an
        // `error` from a check that failed at launch, and opening a wallet
        // to be told an update "could not be verified" - about a download
        // that was never offered, let alone attempted - would be alarming
        // and wrong. A failure is worth showing when the user asked for
        // something; a stale one is not.
        let cancelled = false;
        if (typeof bridge.getState === 'function') {
            Promise.resolve(bridge.getState()).then((event) => {
                if (cancelled || event?.type !== 'available') return;
                const next = String(event?.info?.version ?? '');
                setVersion(SEMVER.test(next) ? next : null);
                setState((current) => (current === 'idle' ? 'available' : current));
            }).catch(() => { /* no offer to show */ });
        }

        const unsubscribe = bridge.onEvent((event) => {
            const type = event?.type;
            if (type === 'available') {
                const next = String(event?.info?.version ?? '');
                setVersion(SEMVER.test(next) ? next : null);
                setState('available');
                setDismissed(false);
                return;
            }
            // `verifying` is the S5 gate reading the signed manifest. It is
            // shown rather than hidden because it is the one step that can
            // take a visible moment after the download finishes.
            if (type === 'verifying') setState('installing');
            if (type === 'rejected' || type === 'error') setState('refused');
        });

        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, []);

    const install = useCallback(() => {
        const bridge = updaterBridge();
        if (!bridge) return;
        setState('installing');
        // A successful install quits and relaunches the app, so the only
        // resolutions observed here are refusals.
        bridge.install()
            .then((result) => { if (!result?.ok) setState('refused'); })
            .catch(() => setState('refused'));
    }, []);

    if (dismissed || state === 'idle') return null;

    return (
        <div role="status" aria-live="polite" style={WRAP}>
            <span aria-hidden="true">⬆</span>
            <div style={{ flex: 1 }}>
                {state === 'available' ? (
                    version
                        ? `Version ${version} is available.`
                        : 'A newer version is available.'
                ) : null}
                {state === 'installing' ? 'Downloading and checking the signature...' : null}
                {state === 'refused' ? (
                    'This update could not be verified, so it was not installed. '
                    + 'Your wallet is untouched. Check docs.xchain.io for how to verify a release by hand.'
                ) : null}
            </div>
            {state === 'available' ? (
                <button type="button" onClick={install} style={LINK_BUTTON}>
                    Install and restart
                </button>
            ) : null}
            {state === 'installing' ? null : (
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
