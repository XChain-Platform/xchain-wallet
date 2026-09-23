// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CI-only global setup for the web venue: runs the boundary, chaos and a11y
// vitest tiers ahead of the browser specs, so a red tier fails this job
// instead of never running anywhere in the pipeline. No-op outside CI.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CI_ONLY_SUITES = ['test:boundary', 'test:chaos', 'test:a11y'];

export default function globalSetup() {
    if (!process.env.CI) return;

    for (const suite of CI_ONLY_SUITES) {
        execFileSync('pnpm', ['run', suite], {
            cwd: REPO_ROOT,
            env: process.env,
            stdio: 'inherit',
        });
    }
}
