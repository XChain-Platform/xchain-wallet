// Smoke for §12 / Cluster S FOLLOWUP 4 — blocklist audit log.
//
// Pins:
//   - blocklist.js exports listBlocklistAuditLog + clearBlocklistAuditLog.
//   - addBlockedOrigin appends an 'add' audit entry only on a real
//     state change (idempotent re-add doesn't pollute the log).
//   - removeBlockedOrigin appends a 'remove' entry only when an entry
//     actually got removed.
//   - The ring-buffer caps at 50 entries; oldest fall off.
//   - Schema validator accepts blocklistAuditLog as v2-tolerant.
//   - Host registers sites.auditLog.list + sites.auditLog.clear; both
//     popup + web messaging shims expose listBlocklistAuditLog +
//     clearBlocklistAuditLog routed to those host names.
//   - ConnectedSitesSection mounts a BlocklistAuditPanel, gated on
//     blocklistWired + listBlocklistAuditLog availability.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    addBlockedOrigin,
    removeBlockedOrigin,
    listBlocklistAuditLog,
    clearBlocklistAuditLog,
} from '../../../packages/core/src/flows/blocklist.js';
import { validateSettings, createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const blocklistSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'blocklist.js'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const popupShim = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webShim = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const sectionSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ConnectedSitesSection.jsx'),
    'utf8',
);

// ─── 1. flow exports ────────────────────────────────────────────────────

assert.equal(typeof listBlocklistAuditLog, 'function', 'listBlocklistAuditLog exported');
assert.equal(typeof clearBlocklistAuditLog, 'function', 'clearBlocklistAuditLog exported');
assert.match(blocklistSrc, /AUDIT_MAX = 50/, 'ring-buffer cap = 50');
assert.match(blocklistSrc, /function withAudit\(/, 'withAudit helper exists');
assert.match(blocklistSrc, /function trimAudit\(/, 'trimAudit helper exists');

// ─── 2. behavioral: add + remove appends, idempotent skip ──────────────

function makeFakeVault({ initialBlocked = [], sites = [], auditLog = [] }) {
    let settingsRecord = {
        ...createDefaultSettings(),
        blockedOrigins: [...initialBlocked],
        blocklistAuditLog: [...auditLog],
    };
    const remainingSites = [...sites];
    return {
        settings: {
            async get() { return JSON.parse(JSON.stringify(settingsRecord)); },
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
        _peekSettings: () => JSON.parse(JSON.stringify(settingsRecord)),
    };
}

{
    const vault = makeFakeVault({});
    await addBlockedOrigin({ vault, origin: 'https://a.com' });
    let log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 1, 'first add appends one entry');
    assert.equal(log[0].action, 'add', 'entry action is "add"');
    assert.equal(log[0].entry, 'https://a.com', 'entry carries canonical origin');
    assert.equal(typeof log[0].at, 'number', 'entry has numeric timestamp');

    // Idempotent re-add — log unchanged.
    await addBlockedOrigin({ vault, origin: 'https://a.com' });
    log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 1, 'idempotent re-add does not duplicate the audit entry');

    await removeBlockedOrigin({ vault, origin: 'https://a.com' });
    log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 2, 'remove appends a second entry');
    assert.equal(log[1].action, 'remove', 'second entry action is "remove"');

    // No-op remove (entry not present) — log unchanged.
    await removeBlockedOrigin({ vault, origin: 'https://a.com' });
    log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 2, 'no-op remove does not append');
}

// Wildcard add records eviction count.
{
    const vault = makeFakeVault({
        sites: [
            { id: 'x', origin: 'https://sub.example.com' },
            { id: 'y', origin: 'https://other.com' },
        ],
    });
    await addBlockedOrigin({ vault, origin: '*.example.com' });
    const log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 1, 'wildcard add records one audit entry');
    assert.deepEqual(log[0].evictedSiteIds, ['x'],
        'audit entry carries the evicted site ids');
}

// ─── 3. ring-buffer cap ────────────────────────────────────────────────

{
    const vault = makeFakeVault({});
    for (let i = 0; i < 60; i += 1) {
        // alternate add+remove to keep generating mutations
        await addBlockedOrigin({ vault, origin: `https://h${i}.com` });
        await removeBlockedOrigin({ vault, origin: `https://h${i}.com` });
    }
    const log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 50, 'log capped at 50 entries');
    // First entry should be from late iteration, not the first.
    assert.match(log[0].entry, /h\d+\.com/, 'oldest survivor is still well-formed');
}

// ─── 4. clear ──────────────────────────────────────────────────────────

{
    const vault = makeFakeVault({});
    await addBlockedOrigin({ vault, origin: 'https://a.com' });
    await addBlockedOrigin({ vault, origin: 'https://b.com' });
    const result = await clearBlocklistAuditLog({ vault });
    assert.equal(result.cleared, 2, 'clear returns the number of removed entries');
    const log = await listBlocklistAuditLog({ vault });
    assert.equal(log.length, 0, 'clear empties the log');

    const result2 = await clearBlocklistAuditLog({ vault });
    assert.equal(result2.cleared, 0, 'clear on empty log returns 0');
}

// ─── 5. schema validator accepts the new field ─────────────────────────

{
    const settings = {
        ...createDefaultSettings(),
        blocklistAuditLog: [
            { at: 1700000000000, action: 'add', entry: 'https://a.com' },
            { at: 1700000001000, action: 'remove', entry: 'https://a.com' },
        ],
    };
    const ok = validateSettings(settings);
    assert.equal(ok.ok, true, 'schema validates blocklistAuditLog: ' + JSON.stringify(ok.errors));
}
{
    const settings = {
        ...createDefaultSettings(),
        blocklistAuditLog: [{ at: 'not a number', action: 'add', entry: 'x' }],
    };
    const bad = validateSettings(settings);
    assert.equal(bad.ok, false, 'schema rejects malformed audit entries');
}

// ─── 6. host routes + messaging shims ──────────────────────────────────

assert.match(hostSrc, /sites\.auditLog\.list/, 'host route sites.auditLog.list registered');
assert.match(hostSrc, /sites\.auditLog\.clear/, 'host route sites.auditLog.clear registered');
assert.match(hostSrc, /listBlocklistAuditLog,?\s*\n\s*clearBlocklistAuditLog/,
    'host destructures both flow exports');

for (const [name, src] of [['popup', popupShim], ['web', webShim]]) {
    assert.match(src, /export function listBlocklistAuditLog\(\)/,
        `${name} shim exports listBlocklistAuditLog`);
    assert.match(src, /export function clearBlocklistAuditLog\(\)/,
        `${name} shim exports clearBlocklistAuditLog`);
    assert.match(src, /sendMessage\('sites\.auditLog\.list'\)/,
        `${name} shim routes list to sites.auditLog.list`);
    assert.match(src, /sendMessage\('sites\.auditLog\.clear'\)/,
        `${name} shim routes clear to sites.auditLog.clear`);
}

// ─── 7. UI panel ───────────────────────────────────────────────────────

assert.match(sectionSrc, /<BlocklistAuditPanel/,
    'BlocklistAuditPanel mounted in the section');
assert.match(sectionSrc, /function BlocklistAuditPanel\(\)/,
    'BlocklistAuditPanel defined');
assert.match(sectionSrc, /messaging\.listBlocklistAuditLog\(\)/,
    'panel reads from listBlocklistAuditLog');
assert.match(sectionSrc, /messaging\.clearBlocklistAuditLog\(\)/,
    'Clear log button calls clearBlocklistAuditLog');
assert.match(
    sectionSrc,
    /typeof messaging\?\.listBlocklistAuditLog === 'function'/,
    'BlocklistAuditPanel mount is gated on messaging shim availability',
);

console.log('blocklist-audit-log smoke OK');
