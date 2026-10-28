// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one-line notice a shell shows when it drops a payment link that waited
// behind an approved payment. It rides in the shell's notices slot, so the
// screen the user went to carries it as its first content, and it stays until
// the user dismisses it or leaves that screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusMessage } from '../../ui/index.js';
import { t } from '../../i18n/index.js';

/**
 * @param {string} view     the unlocked view on screen now
 * @param {Record<string, string>} [carries]   views whose notice moves on with the user: { from: to }
 * @returns {{ show: () => void, node: import('react').ReactNode }}
 */
export function useWaitingLinkDropped(view, carries = {}) {
    const [shownOn, setShownOn] = useState(/** @type {string | null} */ (null));
    // Written during render, so a drop reported from an unmount cleanup in the
    // same commit reads the view the user went to.
    const viewRef = useRef(view);
    viewRef.current = view;
    const carriesRef = useRef(carries);
    carriesRef.current = carries;
    const show = useCallback(() => setShownOn(viewRef.current), []);
    useEffect(() => {
        setShownOn((on) => {
            if (on === null || on === view) return on;
            return carriesRef.current[on] === view ? view : null;
        });
    }, [view]);
    const dismiss = useCallback(() => setShownOn(null), []);
    const node = shownOn === null ? null : (
        <StatusMessage
            variant="status"
            testId="waiting-link-dropped"
            recovery={{ label: t('shell.dismiss'), onAction: dismiss }}
        >
            {t('shell.waitingLinkDropped')}
        </StatusMessage>
    );
    return { show, node };
}
