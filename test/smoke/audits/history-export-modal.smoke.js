// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §28.5 / Cluster I FOLLOWUP 5 smoke: History export modal.
//
// Asserts:
//   1. historyExport.js gains a `columns` parameter on entriesToCsv +
//      entriesToJson and a `filterEntriesByDateRange` helper, and
//      exports EXPORT_COLUMNS.
//   2. entriesToCsv with a column subset emits only those columns;
//      JSON honours the same filter and includes the column list in
//      the payload metadata.
//   3. filterEntriesByDateRange filters by inclusive epoch-second
//      bounds, drops timestamp-less rows, accepts open-ended bounds.
//   4. flows/index.js re-exports the new helpers.
//   5. History.jsx exports visible rows with the selected fiat currency.
//   6. ExportModal carries format radios, a column list, filtered-row
//      count, role="dialog" + aria-modal, and Esc closes.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    entriesToCsv,
    entriesToJson,
    filterEntriesByDateRange,
    EXPORT_COLUMNS,
    EXPORT_COLUMN_DETAILS,
} from '../../../packages/core/src/flows/historyExport.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Public surface ------------------------------------------------

assert.equal(typeof entriesToCsv, 'function');
assert.equal(typeof entriesToJson, 'function');
assert.equal(typeof filterEntriesByDateRange, 'function');
assert.ok(Array.isArray(EXPORT_COLUMNS) && EXPORT_COLUMNS.length > 0,
    'EXPORT_COLUMNS exported and non-empty');
assert.deepEqual(Object.keys(EXPORT_COLUMN_DETAILS), EXPORT_COLUMNS,
    'every export column has user-facing documentation');

// --- 2. CSV / JSON honour columns option ------------------------------

const sample = [
    {
        chainId: 'BTC.mainnet',
        address: 'bc1qexample',
        action: 'SEND',
        actionIndex: '1',
        txHash: 'abc',
        blockIndex: 800000,
        timestamp: 1714000000,
        source: 'decoder',
        raw: {
            tick: 'BTC',
            amount: '9007199254740993.123456789',
            memo: 'First, "quoted"\nnext line',
        },
        link: { peer: 'something' },
    },
    {
        chainId: 'LTC.mainnet',
        address: 'ltc1qexample',
        action: 'BATCH',
        actionIndex: '2',
        txHash: 'def',
        blockIndex: 800001,
        timestamp: 1714003600,
        source: 'decoder',
    },
];

const csvAll = entriesToCsv(sample);
assert.ok(csvAll.startsWith(Object.values(EXPORT_COLUMN_DETAILS).map((detail) => detail.label).join(',') + ' (USD)\n'),
    'default CSV header documents every EXPORT_COLUMNS field and selected fiat code');

const csvSubset = entriesToCsv(sample, { columns: ['chainId', 'action', 'iso'] });
const csvLines = csvSubset.trim().split('\n');
assert.equal(csvLines[0], 'Chain,Action,Date (ISO 8601 UTC)',
    'CSV header reflects the requested column subset');
assert.equal(csvLines[1].split(',').length, 3,
    'each CSV row drops to the subset width');
assert.ok(csvLines[1].includes('SEND') && csvLines[1].includes('BTC.mainnet'),
    'subset CSV row carries the picked fields');

const csvMemo = entriesToCsv(sample, {
    columns: ['iso', 'amount', 'memo', 'fiatCurrency'],
    fiatCurrency: 'eur',
});
assert.ok(csvMemo.includes('2024-04-24T23:06:40.000Z'),
    'CSV renders timestamps as ISO dates');
assert.ok(csvMemo.includes('9007199254740993.123456789'),
    'CSV preserves exact decimal amount text');
assert.ok(csvMemo.includes('"First, ""quoted""\nnext line"'),
    'CSV quotes commas, quotes, and newlines in memos');
assert.ok(csvMemo.startsWith('Date (ISO 8601 UTC),Amount,Memo,Fiat currency (EUR)\n'),
    'CSV labels the fiat column with the selected currency');
assert.ok(csvMemo.includes(',EUR\n'),
    'CSV uses the selected fiat currency');

const jsonAll = JSON.parse(entriesToJson(sample));
assert.deepEqual(jsonAll.columns, EXPORT_COLUMNS.slice(),
    'JSON payload echoes the column set used');
assert.equal(jsonAll.columnHeaders.fiatCurrency, 'Fiat currency (USD)',
    'JSON documents the normalized fiat column label');
assert.equal(jsonAll.entries[0].chainId, 'BTC.mainnet');
assert.equal(jsonAll.entries[0].link?.peer, 'something',
    'JSON preserves link sidecar even when not in column set');

const jsonSubset = JSON.parse(entriesToJson(sample, { columns: ['action', 'address'] }));
assert.deepEqual(jsonSubset.columns, ['action', 'address']);
assert.deepEqual(Object.keys(jsonSubset.entries[0]).sort(),
    ['action', 'address', 'link', 'raw'].sort(),
    'JSON entry includes only requested columns + sidecars (link/raw kept)');

// Bad / empty columns array falls back to default; preserves existing
// caller behaviour.
const csvBadCols = entriesToCsv(sample, { columns: ['nonsense'] });
assert.equal(csvBadCols.split('\n')[0], csvAll.split('\n')[0],
    'unknown-only column subset falls back to all columns');
const csvEmptyCols = entriesToCsv(sample, { columns: [] });
assert.equal(csvEmptyCols.split('\n')[0], csvAll.split('\n')[0],
    'empty column subset falls back to all columns');

// --- 3. Date-range filter --------------------------------------------

const ranged = filterEntriesByDateRange(sample, { fromTs: 1714000001, toTs: null });
assert.equal(ranged.length, 1, 'open-ended-to bound includes everything ≥ from');
assert.equal(ranged[0].txHash, 'def');

const rangedClosed = filterEntriesByDateRange(sample, { fromTs: 1713999999, toTs: 1714000001 });
assert.equal(rangedClosed.length, 1, 'inclusive [from, to] window picks the row inside');
assert.equal(rangedClosed[0].txHash, 'abc');

const noTimestamp = filterEntriesByDateRange([{ txHash: 'x' }, { txHash: 'y', timestamp: 0 }], { fromTs: 0, toTs: 9999999999 });
assert.deepEqual(noTimestamp, [], 'rows without a positive timestamp are dropped');

const passThrough = filterEntriesByDateRange(sample, {});
assert.equal(passThrough.length, sample.length, 'no-bounds call returns a copy of the input array');

// --- 4. Re-exports through flows/index.js -----------------------------

const indexSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);
assert.ok(/EXPORT_COLUMNS,/.test(indexSrc),
    'flows/index.js re-exports EXPORT_COLUMNS');
assert.ok(/EXPORT_COLUMN_DETAILS,/.test(indexSrc),
    'flows/index.js re-exports EXPORT_COLUMN_DETAILS');
assert.ok(/filterEntriesByDateRange,/.test(indexSrc),
    'flows/index.js re-exports filterEntriesByDateRange');

// --- 5 + 6. History.jsx wiring + modal --------------------------------

const historySrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'History.jsx'),
    'utf8',
);
assert.ok(!/Export CSV<\/button>/.test(historySrc),
    'History.jsx no longer renders the bare Export-CSV chip');
assert.ok(!/Export JSON<\/button>/.test(historySrc),
    'History.jsx no longer renders the bare Export-JSON chip');
assert.ok(/t\('history\.export\.open'\)/.test(historySrc),
    'History.jsx now renders a single "Export…" trigger');
assert.ok(/aria-haspopup="dialog"/.test(historySrc),
    'Export trigger announces it opens a dialog');
assert.ok(/aria-expanded=\{exportModalOpen\}/.test(historySrc),
    'Export trigger reports its expanded state');
assert.ok(/<ExportModal\b/.test(historySrc) || /function ExportModal\(/.test(historySrc),
    'History.jsx mounts an ExportModal');
assert.ok(/role="dialog"[\s\S]{0,80}?aria-modal="true"/.test(historySrc),
    'ExportModal carries role="dialog" + aria-modal');
assert.ok(/name="export-format"[\s\S]*?value="csv"[\s\S]*?value="json"/.test(historySrc),
    'ExportModal radio group covers CSV + JSON');
assert.ok(!/name="export-scope"/.test(historySrc),
    'ExportModal cannot switch away from the filtered view');
assert.ok(/EXPORT_COLUMNS\.map/.test(historySrc),
    'ExportModal renders one checkbox per EXPORT_COLUMNS entry');
assert.ok(/EXPORT_COLUMN_DETAILS\[col\]/.test(historySrc),
    'ExportModal explains each selectable column');
assert.ok(/t\('history\.export\.rowCount', \{ count: visibleCount \}\)/.test(historySrc),
    'ExportModal explains that it exports filtered rows');
assert.ok(/e\.key === 'Escape'/.test(historySrc),
    'ExportModal closes on Escape');
assert.ok(/runExport\(\{[\s\S]+?columns: Array\.from\(exportColumns\)/.test(historySrc),
    'Confirm button passes the selected column set into runExport');
assert.ok(/entries: visibleEntries/.test(historySrc),
    'History.jsx passes only visible rows into runExport');
assert.ok(/fiatCurrency,/.test(historySrc),
    'History.jsx passes the selected fiat currency into runExport');
assert.ok(/disabled=\{visibleEntries\.length === 0\}/.test(historySrc),
    'Export trigger disables when no filtered rows are visible');
assert.ok(/history-export-disabled-reason/.test(historySrc),
    'Export trigger points to its empty-view explanation');

console.log(
    'OK: history export serializes ISO dates, quoted memos, and selected fiat; History exports visible rows and disables the trigger with a reason when none are visible',
);
