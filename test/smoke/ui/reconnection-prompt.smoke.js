// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §49.5 / G154 / Cluster G FOLLOWUP 3 — reconnection prompt.
//
// QueuedBroadcastBanner now subscribes to useReachability and fires a
// one-shot toast when the `overall` value transitions from
// offline|degraded back to normal AND the queue is non-empty.
//
// The user gets `"You have N queued transactions. Broadcast now?"` with
// an "Open queue" action that focuses + scrolls the banner. Toast
// honors a 60s dedupe floor so flapping connections don't spam the
// notification.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const banner = join(core, 'src', 'shared', 'components', 'QueuedBroadcastBanner.jsx');

assert.ok(existsSync(banner), 'QueuedBroadcastBanner.jsx exists');
const src = readFileSync(banner, 'utf8');

// --- 1. Imports the prerequisite hooks ---------------------------------

assert.ok(
    /import \{ useReachability \} from '\.\.\/hooks\/useReachability\.js'/.test(src),
    'banner imports useReachability',
);
assert.ok(
    /import \{ useToast \} from '\.\/ToastHost\.jsx'/.test(src),
    'banner imports useToast',
);
assert.ok(
    /import \{ useCallback, useEffect, useRef, useState \} from 'react'/.test(src),
    'banner imports useRef (transition tracking + bannerRef)',
);

// --- 2. Tracks reachability + previous-overall + dedupe ----------------

assert.ok(
    /const \{ overall: reachabilityOverall \} = useReachability\(\{\}\)/.test(src),
    'banner subscribes to useReachability for the overall value',
);
assert.ok(
    /const \{ showToast \} = useToast\(\)/.test(src),
    'banner pulls showToast from useToast',
);
assert.ok(
    /const prevOverallRef = useRef/.test(src),
    'banner tracks previous overall via ref',
);
assert.ok(
    /const lastPromptedAtRef = useRef/.test(src),
    'banner tracks last-prompted-at for dedupe',
);
assert.ok(
    /const bannerRef = useRef/.test(src),
    'banner exposes a DOM ref so the toast action can focus it',
);

// --- 3. Transition-detect useEffect ------------------------------------

const effectMatch = /useEffect\(\(\) => \{\s*\n\s*const prev = prevOverallRef\.current;[\s\S]+?\}, \[reachabilityOverall, queue\.length, showToast\]\);/.exec(src);
assert.ok(effectMatch, 'banner has a transition-detection useEffect');
const effectBody = effectMatch[0];
assert.ok(
    /prevOverallRef\.current = reachabilityOverall/.test(effectBody),
    'effect updates the prev ref on every poll',
);
assert.ok(
    /if \(prev !== 'offline' && prev !== 'degraded'\) return/.test(effectBody),
    'effect only fires when previous was offline or degraded',
);
assert.ok(
    /if \(reachabilityOverall !== 'normal'\) return/.test(effectBody),
    'effect only fires when current is normal (recovery)',
);
assert.ok(
    /if \(queue\.length === 0\) return/.test(effectBody),
    'effect skips the toast when nothing is queued',
);
assert.ok(
    /now - lastPromptedAtRef\.current < 60_000/.test(effectBody),
    'effect dedupes within a 60-second window',
);

// --- 4. Toast payload --------------------------------------------------

assert.ok(
    /You have 1 queued transaction\. Broadcast now\?/.test(effectBody),
    'singular form of the prompt copy',
);
assert.ok(
    /You have \$\{queue\.length\} queued transactions\. Broadcast now\?/.test(effectBody),
    'plural form of the prompt copy',
);
assert.ok(
    /actionLabel: 'Open queue'/.test(effectBody),
    'toast surfaces an "Open queue" action',
);
assert.ok(
    /bannerRef\.current\.focus\(\)/.test(effectBody),
    '"Open queue" action focuses the banner',
);
assert.ok(
    /scrollIntoView/.test(effectBody),
    '"Open queue" action scrolls the banner into view',
);
assert.ok(
    /durationMs: 12_000/.test(effectBody),
    'toast lingers 12 seconds — long enough to read',
);

// --- 5. Banner DOM gets ref + tabIndex so focus() works ----------------

assert.ok(
    /<div\s+ref=\{bannerRef\}[\s\S]+?tabIndex=\{-1\}/.test(src),
    'banner div carries the ref + tabIndex={-1} so it can be focused programmatically',
);

console.log('reconnection-prompt smoke OK');
