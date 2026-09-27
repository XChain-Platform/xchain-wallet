// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The regtest full-node sidecar is not in a `store` build.
//
// The transform under test is string surgery over a package we do not own, so
// the tests that matter run it against the REAL `xchain-sdk` source on disk
// rather than a fixture: a fixture would keep passing forever after the SDK
// changed shape, which is the one failure this cleanup can have.
//
// Three properties, in the order they can break:
//
//   1. it removes both halves from the actual shipped source (the config
//      literal AND the loader that reads it), leaving no marker behind;
//   2. what it leaves is still valid JavaScript that resolves EVERY coin and
//      network to byte-identical config, and hashes to the same consensus
//      pin - a half-deleted statement in a dependency would be a worse
//      outcome than the dead code it removes;
//   3. it is a real deletion, not a mute: with a sidecar file actually sitting
//      in cwd, the untouched module reads it and the stripped one does not.
//
// What these do NOT prove is the artifact. Only a build does that, which is
// why the plugin scans the emitted `store` bundle and fails the build shut on
// any surviving marker (`generateBundle` in packages/web/regtestSidecar.js).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import {
    REGTEST_SIDECAR_MARKERS,
    SIDECAR_KEY,
    STORE_PROFILE,
    findRegtestSidecarMarkers,
    removeSidecarLoader,
    stripRegtestSidecar,
} from '../../../packages/web/regtestSidecar.js';
import { BUILD_PROFILES } from '../../../packages/web/buildProfile.js';

const require = createRequire(import.meta.url);

/** The SDK's coin registry as it sits in node_modules, i.e. what gets bundled. */
const sdkCoins = dirname(require.resolve('xchain-sdk/src/coins/index.js'));
const SDK_COIN_FILES = ['index.js', 'BTC.js', 'LTC.js', 'DOGE.js', 'consensus_pin.js'];
// Cache the installed source once so every assertion and fixture uses the same bytes.
const SDK_SOURCES = new Map(SDK_COIN_FILES.map((file) => [
    file, readFileSync(join(sdkCoins, file), 'utf8'),
]));
const SDK_FIXTURE_TIMEOUT = 60_000;

/** Two working copies: one untouched, one with the transform applied. */
let workDir;
let pristine;
let stripped;

beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'xc1016-'));
    pristine = join(workDir, 'pristine');
    stripped = join(workDir, 'stripped');
    mkdirSync(pristine);
    mkdirSync(stripped);
    for (const [file, source] of SDK_SOURCES) {
        writeFileSync(join(pristine, file), source);
        writeFileSync(join(stripped, file), stripRegtestSidecar(source).code);
    }
}, SDK_FIXTURE_TIMEOUT);

afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
}, SDK_FIXTURE_TIMEOUT);

describe('the markers a store build must not contain', { timeout: SDK_FIXTURE_TIMEOUT }, () => {
    it('name the config key, the file it points at, and the line users saw', () => {
        // The log line is listed on its own because it is the observable this
        // item was filed on: a wallet in an app-store build printing
        // "FULLNODE regtest sidecar ignored: r.resolve is not a function".
        expect([...REGTEST_SIDECAR_MARKERS]).toEqual([
            '$regtestSidecar',
            'fullnode.regtest.json',
            'FULLNODE regtest sidecar ignored',
        ]);
        expect(SIDECAR_KEY).toBe('$regtestSidecar');
    });

    it('apply to a profile the build system actually knows', () => {
        expect(BUILD_PROFILES).toContain(STORE_PROFILE);
    });

    it('are found in text and reported in declaration order', () => {
        expect(findRegtestSidecarMarkers('nothing to see')).toEqual([]);
        expect(findRegtestSidecarMarkers(
            'x fullnode.regtest.json y $regtestSidecar z',
        )).toEqual(['$regtestSidecar', 'fullnode.regtest.json']);
        expect(findRegtestSidecarMarkers(null)).toEqual([]);
    });
});

describe('the transform, run against the SDK source that ships', { timeout: SDK_FIXTURE_TIMEOUT }, () => {
    it('finds both halves there in the first place', () => {
        // Guards the tests below from passing vacuously: if the SDK ever stops
        // carrying this, the cleanup is done and the plugin can go - but that
        // has to be noticed, not assumed.
        expect(SDK_SOURCES.get('BTC.js')).toContain(SIDECAR_KEY);
        expect(SDK_SOURCES.get('index.js'))
            .toContain('FULLNODE regtest sidecar ignored');
    });

    it('removes the config literal from the coin data', () => {
        const { removed } = stripRegtestSidecar(SDK_SOURCES.get('BTC.js'));
        expect(removed).toContain('config');
        expect(findRegtestSidecarMarkers(readFileSync(join(stripped, 'BTC.js'), 'utf8')))
            .toEqual([]);
    });

    it('removes the loader block from the registry', () => {
        const { removed } = stripRegtestSidecar(SDK_SOURCES.get('index.js'));
        expect(removed).toContain('loader');
        expect(findRegtestSidecarMarkers(readFileSync(join(stripped, 'index.js'), 'utf8')))
            .toEqual([]);
    });

    it('takes the comment lines that name the sidecar with it', () => {
        // Minification drops these anyway, so no shipped byte changes. They go
        // so the bundle scan can be a flat "no marker anywhere" instead of
        // carrying an exception for comments, which is how a real one hides.
        const { removed } = stripRegtestSidecar(SDK_SOURCES.get('index.js'));
        expect(removed).toContain('comments');
    });

    it('leaves the rest of resolveFullnode standing', () => {
        // The regtest ENV overrides are a different mechanism with no
        // filesystem in it, and they are not what this removes. Deleting them
        // too would change what a regtest developer's Node process resolves.
        const src = readFileSync(join(stripped, 'index.js'), 'utf8');
        expect(src).toContain('$regtestEnvOverrides');
        expect(src).toContain('function resolveFullnode');
        expect(src).toContain('GENESIS_VERIFIERS');
    });
});

describe('what the stripped registry resolves', { timeout: SDK_FIXTURE_TIMEOUT }, () => {
    it('loads as valid JavaScript', () => {
        // A half-deleted statement in someone else's package is the failure
        // mode worth being loudest about: it would break the wallet's whole
        // coin registry, in the profile with the least local coverage.
        expect(() => require(join(stripped, 'index.js'))).not.toThrow();
    });

    it('gives byte-identical config for every coin and network', () => {
        const before = require(join(pristine, 'index.js'));
        const after = require(join(stripped, 'index.js'));
        for (const tick of before.ALLOWED_COINS) {
            for (const network of before.NETWORKS) {
                expect(after.canonicalJson(after.getCoinConfig(tick, network)))
                    .toBe(before.canonicalJson(before.getCoinConfig(tick, network)));
            }
        }
    });

    it('hashes to the same consensus pin', () => {
        // `$`-descriptors are stripped before hashing, so removing one cannot
        // move a pin - but that is an argument, and this is the measurement.
        // A store build that failed verifyConsensusPin would be a wallet that
        // halts on its own config.
        const before = require(join(pristine, 'index.js'));
        const after = require(join(stripped, 'index.js'));
        for (const network of ['testnet', 'regtest']) {
            expect(after.consensusHashes(network)).toEqual(before.consensusHashes(network));
            expect(() => after.verifyConsensusPin(network)).not.toThrow();
        }
    });
});

describe('the deletion is real, not a mute', { timeout: SDK_FIXTURE_TIMEOUT }, () => {
    it('stops a sidecar file in cwd from being read at all', () => {
        // The capability check the SDK added means the loader cannot run in a
        // WebView; this proves the transform removed the loader rather than
        // relying on that check. Node CAN read the file, so the two copies
        // must now disagree, and only here.
        const before = require(join(pristine, 'index.js'));
        const after = require(join(stripped, 'index.js'));
        const cwd = process.cwd();
        writeFileSync(join(workDir, 'fullnode.regtest.json'), JSON.stringify({
            CONFIRM_DEPTH: 7,
        }));
        try {
            process.chdir(workDir);
            expect(before.getCoinConfig('BTC', 'regtest').FULLNODE.CONFIRM_DEPTH).toBe(7);
            expect(after.getCoinConfig('BTC', 'regtest').FULLNODE.CONFIRM_DEPTH).not.toBe(7);
        } finally {
            process.chdir(cwd);
        }
    });
});

describe('the transform when it does not recognize the shape', { timeout: SDK_FIXTURE_TIMEOUT }, () => {
    it('leaves a braceless loader alone rather than half-deleting it', () => {
        const code = 'if (fullnode.$regtestSidecar && ok()) load(fullnode.$regtestSidecar);\n';
        expect(removeSidecarLoader(code)).toEqual({ code, removed: false });
    });

    it('leaves a loader with an else arm alone', () => {
        const code = 'if (fullnode.$regtestSidecar) { a(); } else { b(); }\n';
        expect(removeSidecarLoader(code)).toEqual({ code, removed: false });
    });

    it('leaves an unclosed condition alone', () => {
        const code = 'if (fullnode.$regtestSidecar && ok() {\n';
        expect(removeSidecarLoader(code)).toEqual({ code, removed: false });
    });

    it('is not fooled by braces inside strings or comments', () => {
        const code = [
            'before();',
            'if (fullnode.$regtestSidecar && ok()) {',
            "    log('} not a brace {');",
            '    // } neither is this',
            '    /* }}} nor these */',
            '}',
            'after();',
        ].join('\n');
        const { code: out, removed } = removeSidecarLoader(code);
        expect(removed).toBe(true);
        expect(out).toContain('before();');
        expect(out).toContain('after();');
        expect(findRegtestSidecarMarkers(out)).toEqual([]);
    });

    it('never drops a line that would leave a block comment open', () => {
        // The comment sweep works line by line, so an opening `/*` or a lone
        // terminator carrying a marker must survive: deleting either turns the
        // rest of the file into a comment, or ends one that never started.
        const code = [
            '/* fullnode.regtest.json',
            ' * $regtestSidecar',
            'FULLNODE regtest sidecar ignored */',
            'const a = 1;',
        ].join('\n');
        const out = stripRegtestSidecar(code).code;
        expect(out).toContain('/* fullnode.regtest.json');
        expect(out).toContain('FULLNODE regtest sidecar ignored */');
        expect(out).not.toContain(' * $regtestSidecar');
        expect(out).toContain('const a = 1;');
    });

    it('reports nothing removed for source that never had it', () => {
        const code = 'const a = 1;\n';
        expect(stripRegtestSidecar(code)).toEqual({ code, removed: [] });
    });
});
