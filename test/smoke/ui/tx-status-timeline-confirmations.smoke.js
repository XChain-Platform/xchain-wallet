// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster I FOLLOWUP 6: TxStatusTimeline now accepts an optional
// `chainTip` prop and surfaces a confirmation count on confirmed rows.
// History.jsx derives a per-chain tip from the max blockIndex across
// loaded entries (a lower bound; there is no dedicated chain-tip
// endpoint yet) and threads it through EntryRow to DetailCard.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const timelineSrc = read('packages/core/src/shared/components/TxStatusTimeline.jsx');
const historySrc = read('packages/core/src/shared/routes/History.jsx');

// 1. The component declares chainTip + indexerWatermark in its prop list
//    and JSDoc.
assert.ok(/export function TxStatusTimeline\(\{ entry, chainTip, indexerWatermark \}\)/.test(timelineSrc),
    'TxStatusTimeline accepts chainTip + indexerWatermark props');
assert.ok(/@param \{number\} \[props\.chainTip\]/.test(timelineSrc),
    'TxStatusTimeline JSDoc documents the chainTip prop');
assert.ok(/@param \{number\} \[props\.indexerWatermark\]/.test(timelineSrc),
    'TxStatusTimeline JSDoc documents the indexerWatermark prop');

// 1b. : the stages array carries the full §28.3 ladder, including
//     the 'signed' (first) and 'indexed' (last) stages.
for (const key of ['signed', 'broadcast', 'mempool', 'confirmed', 'indexed']) {
    assert.ok(new RegExp(`key: '${key}'`).test(timelineSrc),
        `TxStatusTimeline stages array includes the '${key}' stage`);
}
assert.ok(timelineSrc.indexOf("key: 'signed'") < timelineSrc.indexOf("key: 'broadcast'"),
    "'signed' stage is rendered before 'broadcast'");
assert.ok(timelineSrc.indexOf("key: 'confirmed'") < timelineSrc.indexOf("key: 'indexed'"),
    "'indexed' stage is rendered after 'confirmed'");
// Indexed is done once the watermark reaches the block; a confirmed row
// with no watermark still reads as indexed (the wallet only shows rows the
// indexer returned).
assert.ok(/const indexed = confirmed && \(watermark > 0 \? watermark >= blockIndex : true\)/.test(timelineSrc),
    'Indexed stage compares the watermark against the entry block with a confirmed fallback');
// Signed is done from an explicit signedAt or an implied one (a txHash means
// the tx was signed before broadcast).
assert.ok(/const signed = signedAt > 0 \|\| txHash\.length > 0/.test(timelineSrc),
    'Signed stage is done from signedAt or a present txHash');

// 2. Confirmation count is computed as tip - blockIndex + 1 (so a tip
//    that equals the row's block reads as "1 confirmation").
assert.ok(/confirmations\s*=\s*confirmed\s*&&\s*tip\s*>=\s*blockIndex\s*\?\s*tip\s*-\s*blockIndex\s*\+\s*1\s*:\s*0/.test(timelineSrc),
    'confirmation count is tip - blockIndex + 1 when tip is present');

// 3. Singular vs plural copy is correct.
assert.ok(/confirmation\$\{confirmations === 1 \? '' : 's'\}/.test(timelineSrc),
    'TxStatusTimeline pluralizes "confirmation"/"confirmations"');

// 4. The Confirmed-row sub line falls back to the timestamp when no
//    chainTip is supplied (existing behaviour preserved).
assert.ok(/confirmedSubBase\s*=\s*confirmed\s*&&\s*timestamp\s*>\s*0/.test(timelineSrc),
    'TxStatusTimeline still falls back to formatted timestamp without chainTip');

// 5. History.jsx derives chainTipByChainId from entries and threads it
//    through both EntryRow call sites + DetailCard + TxStatusTimeline.
assert.ok(/Cluster I FOLLOWUP 6/.test(historySrc),
    'History.jsx tags the chainTip block with the FOLLOWUP id');
assert.ok(/const chainTipByChainId = useMemo/.test(historySrc),
    'History.jsx memoizes chainTipByChainId');
assert.ok(/chainTip=\{chainTipByChainId\[entry\.chainId\]\}/.test(historySrc),
    'History.jsx threads chainTip into EntryRow');
assert.ok(/function EntryRow\(\{[^}]*\bchainTip\b[^}]*\bindexerWatermark\b[^}]*\bwalletId\b[^}]*\}\)/.test(historySrc),
    'EntryRow declares the chainTip + indexerWatermark props');
assert.ok(/<DetailCard entry=\{entry\} peerCache=\{peerCache\} isFull=\{isFull\} chainTip=\{chainTip\} indexerWatermark=\{indexerWatermark\} walletId=\{walletId\} \/>/.test(historySrc),
    'EntryRow forwards chainTip + indexerWatermark to DetailCard');
assert.ok(/function DetailCard\(\{ entry, peerCache, chainTip, indexerWatermark, walletId \}\)/.test(historySrc),
    'DetailCard declares the chainTip + indexerWatermark props');
assert.ok(/<TxStatusTimeline entry=\{entry\} chainTip=\{chainTip\} indexerWatermark=\{indexerWatermark\} \/>/.test(historySrc),
    'DetailCard forwards chainTip + indexerWatermark to TxStatusTimeline');

// : History.jsx fetches the per-chain indexer watermark and threads
// it through every EntryRow alongside chainTip.
assert.ok(/const \[indexerWatermarkByChainId, setIndexerWatermarkByChainId\] = useState/.test(historySrc),
    'History.jsx holds indexerWatermarkByChainId state');
assert.ok(/messaging\.getIndexerWatermark\(\{ chainId: cid \}\)/.test(historySrc),
    'History.jsx fetches the watermark via messaging.getIndexerWatermark');

// 6. Both EntryRow occurrences in the row-render branches receive both
//    chainTip and indexerWatermark: group-member rows AND top-level rows.
const entryRowMentions = (historySrc.match(/<EntryRow\b/g) || []).length;
const entryRowChainTipMentions = (historySrc.match(/chainTip=\{chainTipByChainId\[entry\.chainId\]\}/g) || []).length;
assert.equal(entryRowChainTipMentions, entryRowMentions,
    `every <EntryRow> in History.jsx receives chainTip (got ${entryRowChainTipMentions} of ${entryRowMentions})`);
const wmMentions = (historySrc.match(/indexerWatermark=\{indexerWatermarkByChainId\[entry\.chainId\]\}/g) || []).length;
assert.equal(wmMentions, entryRowMentions,
    `every <EntryRow> in History.jsx receives indexerWatermark (got ${wmMentions} of ${entryRowMentions})`);

console.log('OK: TxStatusTimeline confirmations + History.jsx wiring');
