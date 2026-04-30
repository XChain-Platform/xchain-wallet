// Smoke for §12 / Cluster S FOLLOWUP 3 — wildcard / domain blocklist
// entries.
//
// Pins:
//   - parseWildcardPattern + normalizeBlocklistEntry exports.
//   - isOriginBlocked recognizes wildcard patterns. Apex is NOT
//     matched by *.example.com (consistent with browser cookie
//     scoping — *.example.com matches sub.example.com but not
//     example.com). Subdomains do match including deeper levels.
//   - addBlockedOrigin accepts wildcards, stores them as `*.host`
//     verbatim (no scheme), and evicts every ConnectedSite whose
//     origin matches the wildcard at write time.
//   - The Settings panel hint mentions wildcards + the apex caveat.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseWildcardPattern,
    normalizeBlocklistEntry,
    isOriginBlocked,
    addBlockedOrigin,
} from '../../../packages/core/src/flows/blocklist.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sectionSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ConnectedSitesSection.jsx'),
    'utf8',
);

// ─── 1. parseWildcardPattern ────────────────────────────────────────────

assert.equal(parseWildcardPattern('*.example.com'), 'example.com',
    'parses bare wildcard');
assert.equal(parseWildcardPattern('*.SubMod.Example.COM'), 'submod.example.com',
    'lowercases the domain');
assert.equal(parseWildcardPattern('example.com'), null,
    'plain origin is not a wildcard');
assert.equal(parseWildcardPattern('*.com'), null,
    'requires multi-label apex');
assert.equal(parseWildcardPattern('*'), null,
    'lone wildcard rejected');
assert.equal(parseWildcardPattern('a.*.example.com'), null,
    'mid-string wildcards rejected');
assert.equal(parseWildcardPattern(null), null, 'null handled');

// ─── 2. normalizeBlocklistEntry ────────────────────────────────────────

assert.equal(normalizeBlocklistEntry('https://example.com'), 'https://example.com',
    'exact origin passes through');
assert.equal(normalizeBlocklistEntry('example.com'), 'https://example.com',
    'bare host normalized to https://');
assert.equal(normalizeBlocklistEntry('*.example.com'), '*.example.com',
    'wildcard kept verbatim (no scheme prepended)');
assert.equal(normalizeBlocklistEntry('   *.Example.COM   '), '*.example.com',
    'wildcard normalized lowercase');
assert.equal(normalizeBlocklistEntry(''), null, 'empty rejected');

// ─── 3. isOriginBlocked with wildcards ─────────────────────────────────

const list = ['*.example.com', 'https://other.com'];
assert.equal(isOriginBlocked(list, 'https://sub.example.com'), true,
    'wildcard matches subdomain');
assert.equal(isOriginBlocked(list, 'https://deep.sub.example.com'), true,
    'wildcard matches deeper subdomain');
assert.equal(isOriginBlocked(list, 'https://example.com'), false,
    'wildcard does NOT match the apex');
assert.equal(isOriginBlocked(list, 'https://other.com'), true,
    'exact origin still matches alongside wildcards');
assert.equal(isOriginBlocked(list, 'https://otherbad.com'), false,
    'unrelated origins not blocked');
// Port handling: pattern matches regardless of port on the request.
assert.equal(isOriginBlocked(['*.example.com'], 'https://sub.example.com:8443'), true,
    'wildcard matches origin with port');
// Schemes: wildcard matches any scheme on the host.
assert.equal(isOriginBlocked(['*.example.com'], 'http://sub.example.com'), true,
    'wildcard matches http origin too');

// ─── 4. addBlockedOrigin accepts wildcard + evicts matching sites ──────

function makeFakeVault({ initialBlocked = [], sites = [] }) {
    let settingsRecord = { blockedOrigins: [...initialBlocked] };
    const remainingSites = [...sites];
    return {
        settings: {
            async get() { return { ...settingsRecord, blockedOrigins: [...settingsRecord.blockedOrigins] }; },
            async put(rec) { settingsRecord = rec; },
        },
        connectedSites: {
            async list() { return [...remainingSites]; },
            async findBy(_field, value) {
                return remainingSites.filter((s) => s.origin === value);
            },
            async delete(id) {
                const idx = remainingSites.findIndex((s) => s.id === id);
                if (idx >= 0) remainingSites.splice(idx, 1);
            },
        },
        _peekSites: () => [...remainingSites],
    };
}

{
    const vault = makeFakeVault({
        sites: [
            { id: 'a', origin: 'https://sub.example.com' },
            { id: 'b', origin: 'https://example.com' },
            { id: 'c', origin: 'https://other.com' },
        ],
    });
    const result = await addBlockedOrigin({ vault, origin: '*.example.com' });
    assert.equal(result.blocked, '*.example.com', 'returns the canonical wildcard');
    assert.equal(result.alreadyBlocked, false, 'first add reports new');
    assert.deepEqual(result.evictedSiteIds.sort(), ['a'], 'only the subdomain site evicted, apex spared');
    assert.deepEqual(vault._peekSites().map((s) => s.id).sort(), ['b', 'c'],
        'apex + unrelated still in connectedSites');
}

{
    const vault = makeFakeVault({
        initialBlocked: ['*.example.com'],
        sites: [{ id: 'a', origin: 'https://sub.example.com' }],
    });
    const result = await addBlockedOrigin({ vault, origin: '*.example.com' });
    assert.equal(result.alreadyBlocked, true, 're-add reports already blocked');
}

// ─── 5. UI hint mentions wildcards ─────────────────────────────────────

assert.match(sectionSrc, /\*\.example\.com/,
    'BlockedOrigins panel hint mentions wildcards');
assert.match(sectionSrc, /aria-label="Origin or wildcard to block"/,
    'manual-block input aria-label updated for wildcards');
assert.match(sectionSrc, /placeholder="https:\/\/example\.com or \*\.example\.com"/,
    'manual-block input placeholder mentions both forms');

console.log('blocklist-wildcards smoke OK');
