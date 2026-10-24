// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useNativeBackRoot } from '../../ui/backStack.js';
import { useToast } from '../components/ToastHost.jsx';
import { t } from '../../i18n/index.js';

/**
 * Make the mounted screen a root where Android Back leaves the app: the first
 * press shows a short hint, and a second press within the window backgrounds
 * the app. The hint lasts only as long as the window it describes.
 * Welcome and unlock pass `skipHistory`, because the WebView history they
 * inherit belongs to a session that has ended.
 *
 * @param {boolean} [enabled]
 * @param {boolean} [skipHistory]
 */
export function useNativeExitRoot(enabled = true, skipHistory) {
    const { showToast } = useToast();
    useNativeBackRoot(enabled, (durationMs) => showToast({
        message: t('common.exitHint'),
        durationMs,
    }), skipHistory);
}
