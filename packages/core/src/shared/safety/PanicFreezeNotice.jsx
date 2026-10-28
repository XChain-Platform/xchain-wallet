// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// React binding for the panic-mode disclosure policy. The policy
// itself is pure and lives in panicNotice.js; this file only decides when to
// re-read the persisted freeze and how to draw it.
//
// Re-read triggers, beyond the initial mount:
//   - any change to the freeze this context enforces (subscribePanicModeState):
//     a hydrate that lands after mount, a store event relayed from another
//     extension context, a freeze held for the worker, an activation here
//   - a 30s tick, so the countdown stays honest without a per-second render
//   - window focus, because a popup or tab can be re-shown long after mount
//   - the `storage` event, because another tab (or, in the extension, another
//     context relaying chrome.storage.onChanged) can arm or clear the freeze
//     while this view is open

import { useEffect, useState } from 'react';
import { FormNotice, StatusMessage } from '../../ui/index.js';
import { getPanicModeState, subscribePanicModeState } from '../../flows/panicMode.js';
import { PANIC_SURFACE_HOME, PANIC_SURFACE_SIGN, panicFreezeNotice } from './panicNotice.js';

const TICK_MS = 30_000;

/**
 * Identity for a notice, so a tick that changes nothing the user can see does
 * not re-render the tree. The countdown text is part of it, so the minute it
 * ticks over still lands.
 *
 * @param {import('./panicNotice.js').PanicNotice|null} notice
 * @returns {string}
 */
function noticeKey(notice) {
    if (!notice) return 'none';
    return `${notice.armedBy}|${notice.disclose ? 'd' : 's'}|${notice.remainingText}`;
}

/**
 * Live panic-freeze notice for one surface.
 *
 * Returns `null` when signing is allowed. A result with `disclose: false`
 * means signing IS frozen but this wallet must not say why (duress-armed):
 * callers on the sign surface still have to drop any "ready to sign" claim.
 *
 * @param {'home'|'send'|'sign'} [surface]
 * @returns {import('./panicNotice.js').PanicNotice|null}
 */
export function usePanicFreeze(surface = PANIC_SURFACE_HOME) {
    const [notice, setNotice] = useState(() =>
        panicFreezeNotice({ state: getPanicModeState(), surface }),
    );

    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            if (cancelled) return;
            const next = panicFreezeNotice({ state: getPanicModeState(), surface });
            setNotice((prev) => (noticeKey(prev) === noticeKey(next) ? prev : next));
        };
        refresh();
        const unsubscribe = subscribePanicModeState(refresh);
        const handle = setInterval(refresh, TICK_MS);
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', refresh);
            window.addEventListener('storage', refresh);
        }
        return () => {
            cancelled = true;
            unsubscribe();
            clearInterval(handle);
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', refresh);
                window.removeEventListener('storage', refresh);
            }
        };
    }, [surface]);

    return notice;
}

/**
 * Banner stating the freeze, for surfaces the user reaches BEFORE composing a
 * transaction. Renders nothing when signing is allowed, and nothing when the
 * freeze was duress-armed. Inside a form it is one of the form's notices, the
 * first item of the page content; elsewhere it renders in place.
 *
 * @param {object} props
 * @param {'home'|'send'|'sign'} [props.surface]
 */
export function PanicFreezeNotice({ surface = PANIC_SURFACE_HOME }) {
    const notice = usePanicFreeze(surface);
    if (!notice || !notice.disclose) return null;
    return (
        <FormNotice variant="error" lead={notice.title}>
            {notice.detail}
        </FormNotice>
    );
}

/**
 * Sign-screen replacement for the "Wallet unlocked. No password needed."
 * note. Three outcomes:
 *
 *   not frozen        renders `children` (the caller's usual reassurance)
 *   self-armed        renders the freeze, in its place
 *   duress-armed      renders nothing: the claim is withdrawn without giving
 *                     an observer a cue
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.children]
 */
export function SigningReadyNote({ children }) {
    const notice = usePanicFreeze(PANIC_SURFACE_SIGN);
    if (!notice) return children ?? null;
    if (!notice.disclose) return null;
    return <PanicSignStatus notice={notice} />;
}

/**
 * Sign-screen stand-in for the password field. A screen that asks for a
 * password the freeze will refuse invites the user to type it for nothing, so:
 *
 *   not frozen        renders `children` (the password field)
 *   self-armed        renders the freeze in its place; with no password the
 *                     caller's Approve stays disabled
 *   duress-armed      renders `children` unchanged: a field that vanished
 *                     would be the cue the duress flow promises not to give
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.children]
 */
export function PanicPasswordGate({ children }) {
    const notice = usePanicFreeze(PANIC_SURFACE_SIGN);
    if (!notice || !notice.disclose) return children ?? null;
    return <PanicSignStatus notice={notice} />;
}

/**
 * @param {object} props
 * @param {import('./panicNotice.js').PanicNotice} props.notice
 * @param {string} [props.testId]
 * @param {string} [props.role]
 */
export function PanicSignStatus({ notice, testId, role }) {
    return (
        <StatusMessage variant="error" testId={testId} role={role}>
            <strong>{notice.title}</strong>{' '}{notice.detail}
        </StatusMessage>
    );
}
