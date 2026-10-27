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

/**
 * A form whose submit button sits far below its notices calls the returned
 * `markAttempt` when a submit is refused. After the notices render, focus moves
 * to the form's notice area and it scrolls into view, so the refusal is seen
 * and announced, as the Send form's error summary does.
 *
 * @returns {() => void} markAttempt
 */
export function useFocusNoticeOnAttempt() {
    const [attempt, setAttempt] = useState(0);
    const markAttempt = useCallback(() => setAttempt((n) => n + 1), []);
    useEffect(() => {
        if (attempt === 0 || typeof document === 'undefined') return;
        const area = document.querySelector('[data-form-status]');
        if (!area) return;
        area.focus({ preventScroll: true });
        area.scrollIntoView?.({ block: 'center' });
    }, [attempt]);
    return markAttempt;
}
