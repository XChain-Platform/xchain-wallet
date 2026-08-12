// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the wallet-side gate on the hub's chain-registry snapshot.
//
// The bundled chain descriptors are copied into xchain-hub/src/chain-registry.json
// by bin/sync-chain-registry.mjs. Until now the ONLY thing comparing the two was
// xchain-hub/test/unit/chainRegistry.test.js, which skips when the wallet sibling
// is absent, so a hub-only run skipped the guard and a wallet-only run never
// looked at the hub at all. Wallet b3fd8dd5 corrected the bitcoin-regtest encoder
// port (3023 -> 3003), the snapshot kept 3023 on origin for both repos, and
// nothing anywhere went red.
//
// The first case below is the gate: bin/chain-registry.sync.json is written by
// the sync script and committed with the descriptor edit, so a descriptor change
// that was never mirrored fails HERE, in the wallet's own unit suite, with no
// hub checkout present anywhere.
//
// The rest pin the generator's other half. The generator reads the LOCAL tree,
// so running it from a stale clone rewrites the superseded value back into the
// hub and looks like a legitimate resync; that is the trap the drift only made
// visible. Those cases drive the real script in a child process against fixture
// checkouts, because an exit code is the whole claim and a stubbed one would pin
// the stub.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLED_DESCRIPTORS } from '../../packages/core/src/registry/descriptors/index.js';

// vitest anchors its root to the wallet repo (test/vitest/unit.config.js), so
// cwd is the repo root. import.meta.url is not a file: URL under the transform.
const WS_ROOT = process.cwd();
const SCRIPT = join(WS_ROOT, 'bin', 'sync-chain-registry.mjs');
const FINGERPRINT = join(WS_ROOT, 'bin', 'chain-registry.sync.json');
const DESCRIPTORS_REL = join('packages', 'core', 'src', 'registry', 'descriptors');

/** The digest the sync script records: sha256 over the serialized descriptors. */
function digestOf(descriptors) {
    return createHash('sha256')
        .update(JSON.stringify(JSON.parse(JSON.stringify(descriptors))))
        .digest('hex');
}

// ---- fixture venue ----------------------------------------------------------

const STUB_DESCRIPTOR = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    encoder: { defaultUrl: 'http://localhost', defaultPort: 3003 },
};

/** A descriptors module carrying one descriptor with the given encoder port. */
function descriptorsSource(port) {
    const d = { ...STUB_DESCRIPTOR, encoder: { ...STUB_DESCRIPTOR.encoder, defaultPort: port } };
    return `export const BUNDLED_DESCRIPTORS = ${JSON.stringify([d], null, 4)};\n`;
}

/**
 * A venue laid out the way the real checkouts are: an xchain-wallet carrying the
 * REAL script, and (optionally) an xchain-hub sibling beside it. The descriptors
 * module is a stub - the script only imports BUNDLED_DESCRIPTORS from it, and a
 * stub keeps the fixture readable and the mutation obvious.
 */
function makeVenue({ port = 3003, withHub = true } = {}) {
    const venue = mkdtempSync(join(tmpdir(), 'chain-registry-sync-'));
    const wallet = join(venue, 'xchain-wallet');
    mkdirSync(join(wallet, 'bin', 'lib'), { recursive: true });
    mkdirSync(join(wallet, DESCRIPTORS_REL), { recursive: true });
    cpSync(SCRIPT, join(wallet, 'bin', 'sync-chain-registry.mjs'));
    cpSync(join(WS_ROOT, 'bin', 'lib', 'checkout-freshness.mjs'),
        join(wallet, 'bin', 'lib', 'checkout-freshness.mjs'));
    writeFileSync(join(wallet, DESCRIPTORS_REL, 'index.js'), descriptorsSource(port));
    if (withHub) mkdirSync(join(venue, 'xchain-hub', 'src'), { recursive: true });
    return { venue, wallet, hubSnapshot: join(venue, 'xchain-hub', 'src', 'chain-registry.json') };
}

/** Rewrite the fixture's descriptors, the way a wallet-side fix does. */
function editDescriptors(wallet, port) {
    writeFileSync(join(wallet, DESCRIPTORS_REL, 'index.js'), descriptorsSource(port));
}

/** Run the fixture's copy of the sync script. */
function sync(wallet, args = []) {
    const r = spawnSync(process.execPath, [join(wallet, 'bin', 'sync-chain-registry.mjs'), ...args], {
        encoding: 'utf8',
        cwd: wallet,
        env: { ...process.env },
    });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// -c overrides so a global commit.gpgsign / user identity cannot fail a fixture
// for a reason that is not the fixture.
const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });

/** Commit everything in `dir`. */
function commitAll(dir, message) {
    git(dir, ...GIT_ID, 'add', '-A');
    git(dir, ...GIT_ID, 'commit', '-qm', message);
}

/**
 * A wallet checkout CLONED from an origin that has since moved on: the ordinary
 * state of a shared checkout, and the one the generator cannot see on its own.
 * `where` picks what the origin-only commit touches, because the scoping is the
 * claim - a guard that fired on ANY staleness would fire on nearly every run.
 *
 * The clone is deliberately NOT fetched afterwards, so only a script that
 * refreshes the upstream ref itself can find the commit.
 */
function makeVenueBehindOrigin({ where = 'descriptors', originPort = 3013 } = {}) {
    const origin = makeVenue({ withHub: false });
    git(origin.wallet, 'init', '-q', '-b', 'master');
    commitAll(origin.wallet, 'fixture');

    const venue = mkdtempSync(join(tmpdir(), 'chain-registry-clone-'));
    const wallet = join(venue, 'xchain-wallet');
    mkdirSync(join(venue, 'xchain-hub', 'src'), { recursive: true });
    execFileSync('git', ['clone', '-q', origin.wallet, wallet], { stdio: 'ignore' });

    if (where === 'descriptors') editDescriptors(origin.wallet, originPort);
    else writeFileSync(join(origin.wallet, 'README.md'), '# upstream\n');
    commitAll(origin.wallet, 'upstream');

    return {
        venue,
        wallet,
        originVenue: origin.venue,
        hubSnapshot: join(venue, 'xchain-hub', 'src', 'chain-registry.json'),
    };
}

const scrub = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

// ---- the gate ---------------------------------------------------------------

describe('chain-registry sync gate @regression', () => {
    it('the committed fingerprint matches the bundled descriptors', () => {
        // THE gate. Red means a descriptor changed and the hub snapshot was
        // never resynced: run xchain-wallet/bin/sync-chain-registry.mjs and
        // commit both files. It reads nothing outside this repo, which is the
        // entire point - the hub-side guard skips when this repo is absent.
        const recorded = JSON.parse(readFileSync(FINGERPRINT, 'utf8'));
        expect(recorded.schema_version).toBe(1);
        expect(recorded.descriptor_count).toBe(BUNDLED_DESCRIPTORS.length);
        expect(recorded.descriptors_sha256).toBe(digestOf(BUNDLED_DESCRIPTORS));
    });

    it('the fingerprint names the artifact it speaks for', () => {
        // A bare digest is unreadable on its own; the file has to say what it
        // is a digest OF, or the next reader deletes it as a mystery artifact.
        const recorded = JSON.parse(readFileSync(FINGERPRINT, 'utf8'));
        expect(recorded.hub_snapshot).toBe('xchain-hub/src/chain-registry.json');
        expect(recorded._comment).toMatch(/sync-chain-registry\.mjs/);
    });

    // ---- what --check proves without a sibling checkout ----------------------

    it('--check FAILS on an unmirrored descriptor change with no hub checkout at all', () => {
        // The ledger's acceptance test , driven end to end: sync once
        // the way a paired tree does, then take the sibling away entirely - a
        // wallet-only clone, which is what every wallet CI job actually has.
        const { venue, wallet } = makeVenue();
        try {
            expect(sync(wallet, ['--allow-stale']).status).toBe(0);
            scrub(join(venue, 'xchain-hub'));

            const clean = sync(wallet, ['--check']);
            expect(clean.status).toBe(0);
            expect(clean.stdout).toMatch(/no xchain-hub checkout beside this one/);

            editDescriptors(wallet, 3023);
            const drifted = sync(wallet, ['--check']);
            expect(drifted.status).toBe(1);
            expect(drifted.stderr).toMatch(/chain-registry\.sync\.json does not match/);
        } finally { scrub(venue); }
    });

    it('a write with no hub checkout is an error, not a silent half-sync', () => {
        // The fingerprint alone would be a lie: it would claim a snapshot had
        // been written that nothing wrote.
        const { venue, wallet } = makeVenue({ withHub: false });
        try {
            const r = sync(wallet, ['--allow-stale']);
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/no xchain-hub checkout/);
            expect(existsSync(join(wallet, 'bin', 'chain-registry.sync.json'))).toBe(false);
        } finally { scrub(venue); }
    });

    it('a sync writes both artifacts, and --check then passes', () => {
        const { venue, wallet, hubSnapshot } = makeVenue();
        try {
            expect(sync(wallet, ['--allow-stale']).status).toBe(0);
            const snapshot = JSON.parse(readFileSync(hubSnapshot, 'utf8'));
            expect(snapshot.descriptors[0].encoder.defaultPort).toBe(3003);
            const recorded = JSON.parse(readFileSync(join(wallet, 'bin', 'chain-registry.sync.json'), 'utf8'));
            expect(recorded.descriptors_sha256).toBe(digestOf(snapshot.descriptors));
            expect(sync(wallet, ['--check']).status).toBe(0);
        } finally { scrub(venue); }
    });

    it('--check reports the hub snapshot separately from the fingerprint', () => {
        // Both halves are named, so a reader knows which copy moved: a hand-edited
        // snapshot is a different accident from an unmirrored descriptor edit.
        const { venue, wallet, hubSnapshot } = makeVenue();
        try {
            sync(wallet, ['--allow-stale']);
            const snapshot = JSON.parse(readFileSync(hubSnapshot, 'utf8'));
            snapshot.descriptors[0].encoder.defaultPort = 3023;
            writeFileSync(hubSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`);
            const r = sync(wallet, ['--check']);
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/chain-registry\.json does not match/);
            expect(r.stderr).not.toMatch(/sync\.json does not match/);
        } finally { scrub(venue); }
    });

    it('a rerun with nothing changed rewrites neither file', () => {
        // generated_at / synced_at stability: a no-op sync that churns timestamps
        // produces diffs nobody can review, and reviewers stop reading them.
        const { venue, wallet, hubSnapshot } = makeVenue();
        try {
            sync(wallet, ['--allow-stale']);
            const before = [readFileSync(hubSnapshot, 'utf8'),
                readFileSync(join(wallet, 'bin', 'chain-registry.sync.json'), 'utf8')];
            const again = sync(wallet, ['--allow-stale']);
            expect(again.status).toBe(0);
            expect(again.stdout).toMatch(/nothing rewritten/);
            expect(readFileSync(hubSnapshot, 'utf8')).toBe(before[0]);
            expect(readFileSync(join(wallet, 'bin', 'chain-registry.sync.json'), 'utf8')).toBe(before[1]);
        } finally { scrub(venue); }
    });

    // ---- the generator's own freshness --------------------------------------

    it('REFUSES to sync from a checkout whose origin has newer descriptors', () => {
        const { venue, wallet, originVenue, hubSnapshot } = makeVenueBehindOrigin();
        try {
            editDescriptors(wallet, 3023);          // the superseded value, locally
            const r = sync(wallet);
            expect(r.status).toBe(2);
            expect(r.stderr).toMatch(/REFUSED/);
            expect(r.stderr).toMatch(/behind origin\/master/);
            // The refusal has to be total: a partially written snapshot would be
            // the same accident with extra steps.
            expect(existsSync(hubSnapshot)).toBe(false);
        } finally { scrub(venue, originVenue); }
    });

    it('finds the origin commit itself, without the operator having fetched', () => {
        // The clone has never fetched, so `origin/master` in it predates the
        // upstream commit. A guard that trusted the local ref would pass here,
        // which is exactly the state a stale clone is usually in.
        const { venue, wallet, originVenue } = makeVenueBehindOrigin();
        try {
            // --no-fetch first, and it passes: the local ref genuinely does not
            // know about the upstream commit yet. That is the documented way to
            // keep the check offline, and the cost of it, in one assertion.
            expect(sync(wallet, ['--no-fetch']).status).toBe(0);
            // The fetching run, on the same refs, refuses.
            expect(sync(wallet).status).toBe(2);
        } finally { scrub(venue, originVenue); }
    });

    it('--allow-stale is the deliberate way past the refusal', () => {
        const { venue, wallet, originVenue, hubSnapshot } = makeVenueBehindOrigin();
        try {
            editDescriptors(wallet, 3023);
            expect(sync(wallet, ['--allow-stale']).status).toBe(0);
            expect(JSON.parse(readFileSync(hubSnapshot, 'utf8')).descriptors[0].encoder.defaultPort)
                .toBe(3023);
        } finally { scrub(venue, originVenue); }
    });

    it('an origin-only commit that does NOT touch the descriptors is not a refusal', () => {
        // Scoping is what keeps the refusal worth having. These are shared
        // checkouts: behind-by-something is their normal state, and only commits
        // to the copied files can change what the generator writes.
        const { venue, wallet, originVenue } = makeVenueBehindOrigin({ where: 'readme' });
        try {
            expect(sync(wallet).status).toBe(0);
        } finally { scrub(venue, originVenue); }
    });

    it('a tree that is not a git checkout syncs, and says the check did not run', () => {
        // Tarball exports and vendored copies are not broken checkouts. Refusing
        // on an unanswerable question would break them for no gain.
        const { venue, wallet } = makeVenue();
        try {
            const r = sync(wallet);
            expect(r.status).toBe(0);
            expect(r.stdout).toMatch(/freshness unchecked \(not a git checkout\)/);
        } finally { scrub(venue); }
    });

    it('--check names staleness as the cause instead of sending you to resync', () => {
        // The one report that must never stand alone: "run the sync script" is
        // harmful advice from a stale clone, because the sync would write the
        // superseded descriptors into the hub.
        const { venue, wallet, originVenue } = makeVenueBehindOrigin();
        try {
            sync(wallet, ['--allow-stale']);        // a fingerprint to drift from
            git(wallet, 'fetch', '-q', 'origin');   // --check never fetches
            editDescriptors(wallet, 3023);
            const r = sync(wallet, ['--check']);
            expect(r.status).toBe(1);
            expect(r.stderr).toMatch(/behind origin\/master/);
            expect(r.stderr).toMatch(/Pull first/);
        } finally { scrub(venue, originVenue); }
    });
});
