// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Desktop Chrome device reports a Windows user agent, and Chromium derives
// navigator.platform from it, so the wallet's shortcut gate expects Ctrl. Playwright
// resolves ControlOrMeta on the host instead (Meta on a Mac), so on a Mac host every
// Cmd/Ctrl+K was dropped and the command palette never opened. Matching the user
// agent to the host keeps both sides on the same modifier. It lives in its own
// module so fixtures can use it without loading a config and its side effects.

import { devices } from '@playwright/test';

export function desktopUserAgentForHost(
    platform = process.platform,
    desktopUserAgent = devices['Desktop Chrome'].userAgent,
) {
    const platformToken = {
        darwin: 'Macintosh; Intel Mac OS X 10_15_7',
        linux: 'X11; Linux x86_64',
        win32: 'Windows NT 10.0; Win64; x64',
    }[platform];
    return platformToken
        ? desktopUserAgent.replace(/\([^)]*\)/, `(${platformToken})`)
        : desktopUserAgent;
}
