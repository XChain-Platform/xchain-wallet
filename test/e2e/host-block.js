// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host-resolver rules every Chromium a harness launches carries.
//
// Route handlers do not see WebSockets or service-worker requests, so the
// resolver is what keeps a test browser off the live services by any
// transport. Two rules exist:
//
//   HOST_BLOCK_ARG        dev-mock and demo harnesses: every host but
//                         loopback fails to resolve.
//   PRODUCTION_BLOCK_ARG  harnesses that drive a regtest venue by name: the
//                         production service hosts fail to resolve, the
//                         venue still answers.
//
// test/unit/tools/harnessHostBlock.test.js holds every config and launch to
// one of them. WebKit takes no Chromium switches; its venues are listed there.

export const HOST_BLOCK_RULES = 'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1';
export const HOST_BLOCK_ARG = `--host-resolver-rules=${HOST_BLOCK_RULES}`;

export const PRODUCTION_BLOCK_RULES = 'MAP *.xchain.io ~NOTFOUND, MAP *.dankest.io ~NOTFOUND, MAP *.dankest.llc ~NOTFOUND';
export const PRODUCTION_BLOCK_ARG = `--host-resolver-rules=${PRODUCTION_BLOCK_RULES}`;

const takesChromiumSwitches = (use = {}) => (use.browserName ?? use.defaultBrowserType ?? 'chromium') === 'chromium';

/**
 * A Playwright project with `arg` added to its Chromium launch args. A
 * WebKit or Firefox project is returned unchanged.
 */
export function withHostBlock(project, arg = HOST_BLOCK_ARG) {
    const use = project.use ?? {};
    if (!takesChromiumSwitches(use)) return project;
    const args = use.launchOptions?.args ?? [];
    if (args.includes(arg)) return project;
    return {
        ...project,
        use: { ...use, launchOptions: { ...use.launchOptions, args: [...args, arg] } },
    };
}
