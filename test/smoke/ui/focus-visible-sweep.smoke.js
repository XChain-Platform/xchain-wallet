// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §53 / Cluster K FOLLOWUP 2 smoke: focus-visible sweep on
// interactive primitives that previously relied on the browser-default
// focus ring.
//
// Asserts that each of the named *.module.css files now carries at
// least one `:focus-visible` rule keyed to the matching button class.
// The default ring disappears against the high-contrast / dark
// palettes, which is the spec's accessibility-blocker; explicit
// `outline: 2px solid var(--xc-focus-ring)` matches the convention
// CopyButton + Button + Input already use.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ui = join(wsRoot, 'packages', 'core', 'src', 'ui');
const components = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components');

/**
 * Each entry: relative CSS path + the button class that needs the
 * focus ring. The pattern matches `.<klass>:focus-visible { ...
 * outline: ... var(--xc-focus-ring) ...}`.
 */
const targets = [
    [join(components, 'AlertsOverlay.module.css'), 'close'],
    [join(components, 'BackupReminderCard.module.css'), 'dismissBtn'],
    [join(components, 'HwSignBlock.module.css'), 'refresh'],
    [join(components, 'QueuedBroadcastBanner.module.css'), 'broadcastBtn'],
    [join(components, 'QueuedBroadcastBanner.module.css'), 'discardBtn'],
    [join(components, 'RawPsbtViewer.module.css'), 'toggle'],
    [join(components, 'RawPsbtViewer.module.css'), 'copyBtn'],
    [join(components, 'ReachabilityBanner.module.css'), 'retry'],
    [join(ui, 'FeeSelector.module.css'), 'slider'],
];

for (const [path, klass] of targets) {
    const src = readFileSync(path, 'utf8');
    const re = new RegExp(`\\.${klass}\\b[\\s\\S]{0,80}?:focus-visible[\\s\\S]{0,200}?--xc-focus-ring`);
    assert.ok(re.test(src), `${path}: .${klass}:focus-visible references --xc-focus-ring`);
}

console.log(
    'OK: focus-visible-sweep smoke (§53 / Cluster K FOLLOWUP 2: explicit :focus-visible rules on AlertsOverlay.close, BackupReminderCard.dismissBtn, HwSignBlock.refresh, QueuedBroadcastBanner.{broadcast,discard}Btn, RawPsbtViewer.{toggle,copyBtn}, ReachabilityBanner.retry, FeeSelector.tier, all keyed to --xc-focus-ring)',
);
