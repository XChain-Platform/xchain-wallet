// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// UpdateNoticeBanner (§6, D4). Mounted beside ReachabilityBanner.
//
// Renders nothing at all unless a shell installed a direct-update provider,
// which only the directly-installed Android APK does. On every other shell
// `hasDirectUpdateLane()` is false and this component returns null before it
// so much as schedules an effect.
//
// WHAT IT DELIBERATELY IS NOT: there is no link, no button that downloads
// anything, and no text that came from the feed. The feed carries exactly one
// semver field and `updateNoticeText()` composes the sentence from that number
// alone (see packages/web/src/update/directUpdateCheck.js). A banner inside a
// wallet that rendered a remote string, or offered a remote destination, is a
// phishing surface with our branding on it; the most a compromised feed can do
// here is claim a version exists.
//
// Dismissal is per-session and not persisted. A user who dismisses it has seen
// it; a user who wants it gone permanently has the Settings switch. Persisting
// the dismissal would need to remember WHICH version was dismissed, and
// getting that wrong silences the next notice too.

import { useEffect, useState } from 'react';
import {
    checkForUpdateNotice,
    hasDirectUpdateLane,
} from '../../flows/directUpdate.js';

export function UpdateNoticeBanner() {
    const [notice, setNotice] = useState(/** @type {string | null} */ (null));
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!hasDirectUpdateLane()) return undefined;
        let live = true;
        // The client itself is rate-limited to once a day and stamps its
        // timestamp BEFORE the request, so mounting this component repeatedly
        // cannot turn into a beacon.
        checkForUpdateNotice()
            .then((result) => {
                if (live && result) setNotice(result.notice);
            })
            .catch(() => { /* a failed check is never worth a dialog */ });
        return () => { live = false; };
    }, []);

    if (!notice || dismissed) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--xc-space-2)',
                padding: 'var(--xc-space-2) var(--xc-space-3)',
                background: 'var(--xc-surface-raised)',
                border: '1px solid var(--xc-border)',
                borderRadius: 'var(--xc-radius-md)',
                fontSize: 'var(--xc-text-sm)',
                color: 'var(--xc-text)',
            }}
        >
            <span aria-hidden="true">⬆</span>
            <div style={{ flex: 1 }}>{notice}</div>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss update notice"
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--xc-text-muted)',
                    cursor: 'pointer',
                    fontSize: 'var(--xc-text-sm)',
                }}
            >
                Dismiss
            </button>
        </div>
    );
}
