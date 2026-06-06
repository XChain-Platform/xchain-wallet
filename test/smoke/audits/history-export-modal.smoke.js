// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// §28.5 / Cluster I FOLLOWUP 5 smoke — History export modal.
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
//   5. History.jsx replaces the two Export-CSV / Export-JSON chips
//      with a single Export… button and mounts <ExportModal>.
//   6. ExportModal carries radio inputs for format + scope, checkbox
//      list for columns sourced from EXPORT_COLUMNS, date inputs for
//      the optional range, role="dialog" + aria-modal, and Esc closes.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    entriesToCsv,
    entriesToJson,
    filterEntriesByDateRange,
    EXPORT_COLUMNS,
} from '../../../packages/core/src/flows/historyExport.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Public surface ------------------------------------------------

assert.equal(typeof entriesToCsv, 'function');
assert.equal(typeof entriesToJson, 'function');
assert.equal(typeof filterEntriesByDateRange, 'function');
assert.ok(Array.isArray(EXPORT_COLUMNS) && EXPORT_COLUMNS.length > 0,
    'EXPORT_COLUMNS exported and non-empty');

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
        link: { peer: 'something' },
        raw: { foo: 'bar' },
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
assert.ok(csvAll.startsWith(EXPORT_COLUMNS.join(',') + '\n'),
    'default CSV header lists every EXPORT_COLUMNS field');

const csvSubset = entriesToCsv(sample, { columns: ['chainId', 'action', 'iso'] });
const csvLines = csvSubset.trim().split('\n');
assert.equal(csvLines[0], 'chainId,action,iso',
    'CSV header reflects the requested column subset');
assert.equal(csvLines[1].split(',').length, 3,
    'each CSV row drops to the subset width');
assert.ok(csvLines[1].includes('SEND') && csvLines[1].includes('BTC.mainnet'),
    'subset CSV row carries the picked fields');

const jsonAll = JSON.parse(entriesToJson(sample));
assert.deepEqual(jsonAll.columns, EXPORT_COLUMNS.slice(),
    'JSON payload echoes the column set used');
assert.equal(jsonAll.entries[0].chainId, 'BTC.mainnet');
assert.equal(jsonAll.entries[0].link?.peer, 'something',
    'JSON preserves link sidecar even when not in column set');

const jsonSubset = JSON.parse(entriesToJson(sample, { columns: ['action', 'address'] }));
assert.deepEqual(jsonSubset.columns, ['action', 'address']);
assert.deepEqual(Object.keys(jsonSubset.entries[0]).sort(),
    ['action', 'address', 'link', 'raw'].sort(),
    'JSON entry includes only requested columns + sidecars (link/raw kept)');

// Bad / empty columns array falls back to default — preserves existing
// caller behaviour.
const csvBadCols = entriesToCsv(sample, { columns: ['nonsense'] });
assert.ok(csvBadCols.startsWith(EXPORT_COLUMNS.join(',') + '\n'),
    'unknown-only column subset falls back to all columns');
const csvEmptyCols = entriesToCsv(sample, { columns: [] });
assert.ok(csvEmptyCols.startsWith(EXPORT_COLUMNS.join(',') + '\n'),
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
assert.ok(/Export…/.test(historySrc),
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
assert.ok(/name="export-scope"[\s\S]*?value="filtered"[\s\S]*?value="all"/.test(historySrc),
    'ExportModal radio group covers filtered + all scopes');
assert.ok(/EXPORT_COLUMNS\.map/.test(historySrc),
    'ExportModal renders one checkbox per EXPORT_COLUMNS entry');
assert.ok(/type="date"/.test(historySrc),
    'ExportModal exposes date inputs for the range');
assert.ok(/e\.key === 'Escape'/.test(historySrc),
    'ExportModal closes on Escape');
assert.ok(/runExport\(\{[\s\S]+?columns: Array\.from\(exportColumns\)/.test(historySrc),
    'Confirm button passes the selected column set into runExport');
assert.ok(/filterEntriesByDateRange/.test(historySrc),
    'History.jsx wires filterEntriesByDateRange when a date range is set');

console.log(
    'OK — history-export-modal smoke (§28.5 / Cluster I FOLLOWUP 5 — entriesToCsv + entriesToJson honour an optional columns subset; filterEntriesByDateRange caps by inclusive epoch-second bounds; flows/index.js re-exports both new symbols + EXPORT_COLUMNS; History.jsx replaces the two chips with a single Export… trigger + ExportModal carrying format radio + columns checkboxes + scope radio + date-range inputs + role="dialog" + Esc-to-close)',
);
