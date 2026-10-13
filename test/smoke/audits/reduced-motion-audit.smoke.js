// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import {
    ESSENTIAL_MOTION_ALLOWLIST,
    runReducedMotionAudit,
} from '../../../packages/core/scripts/reduced-motion-audit.js';

const { motionStylesheetCount, uncovered } = runReducedMotionAudit();
const details = uncovered
    .map(({ file, kinds }) => `  ${file}: ${kinds.join(', ')}`)
    .join('\n');

assert.equal(
    uncovered.length,
    0,
    `CSS files with motion but no reduced-motion override:\n${details}`,
);

console.log(
    `OK: reduced-motion audit smoke (0 uncovered across ${motionStylesheetCount} motion stylesheets; `
    + `${ESSENTIAL_MOTION_ALLOWLIST.size} essential allowlist entries)`,
);
