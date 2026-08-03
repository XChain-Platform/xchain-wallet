// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The store integer, for both stores (rails §2;  reconciled the three
// definitions that used to disagree). Rewritten from the  S1 version of
// this file when that reconciliation landed: the old shape had stable at
// build 0 with a `-hotfix.N` suffix, and both are gone.
//
// The properties worth testing are not "the arithmetic is right" but the four
// things the stores enforce and will not forgive:
//
//   - determinism: one tag, one number, on every machine and every re-run,
//     because the AAB comes off the release machine and the smoke APK off a
//     runner;
//   - monotonicity ALONG A RELEASE SEQUENCE, including the awkward part:
//     betas must sort BELOW the stable they precede, or Play will not let a
//     closed-track tester move up to production;
//   - injectivity under the ceiling: two different tags never collide on one
//     number, and no representable release exceeds Play's 2,100,000,000;
//   - one number, two stores: Android's versionCode and iOS's
//     CFBundleVersion are the same integer, so the shells cannot drift.
//
// The strictness tests matter for the same reason. Every spelling the parser
// accepts loosely is a chance to produce a number that a DIFFERENT tag also
// produces, and the first symptom of that is a release you cannot upload.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';
import {
    MAX_MAJOR,
    MAX_MINOR,
    MAX_PATCH,
    MAX_LANE_N,
    STABLE_BUILD,
    PLAY_VERSION_CODE_CEILING,
    parseTag,
    storeVersionFromTag,
    versionCodeFromTag,
    versionNameFromTag,
    marketingVersionFromTag,
    canonicalTag,
    versionPropertiesFor,
    versionXcconfigFor,
} from '../../../packages/mobile/scripts/version.js';

describe('storeVersionFromTag', () => {
    it('places a stable release at the midpoint of its build band', () => {
        // 0.333.1 -> 3330150, not 3330100: stable sits at 50 so betas have
        // room below it and respins above.
        expect(storeVersionFromTag('v0.333.1')).toBe(3330150);
        expect(versionCodeFromTag('v0.333.1')).toBe(3330150);
    });

    it('places each field in its own decimal slot', () => {
        expect(storeVersionFromTag('v1.0.0')).toBe(10000050);
        expect(storeVersionFromTag('v0.1.0')).toBe(10050);
        expect(storeVersionFromTag('v0.0.1')).toBe(150);
        expect(storeVersionFromTag('v2.34.56')).toBe(20345650);
    });

    it('sorts betas below the stable they precede, and respins above it', () => {
        // This is the ordering Play and App Store Connect both enforce; get
        // it backwards and a tester on the closed track cannot be moved to
        // production without a version bump nobody wanted.
        expect(storeVersionFromTag('v0.333.1-beta.1')).toBe(3330101);
        expect(storeVersionFromTag('v0.333.1-beta.49')).toBe(3330149);
        expect(storeVersionFromTag('v0.333.1')).toBe(3330150);
        expect(storeVersionFromTag('v0.333.1-respin.1')).toBe(3330151);
        expect(storeVersionFromTag('v0.333.1-respin.49')).toBe(3330199);
    });

    it('accepts the tag with or without its leading v', () => {
        expect(storeVersionFromTag('0.333.1')).toBe(storeVersionFromTag('v0.333.1'));
    });

    it('is deterministic: the same tag always yields the same number', () => {
        const runs = new Set(Array.from({ length: 5 }, () => storeVersionFromTag('v0.333.1')));
        expect(runs.size).toBe(1);
    });

    it('increases with every step of a real release sequence', () => {
        const sequence = [
            'v0.333.0',
            'v0.333.1-beta.1',
            'v0.333.1-beta.2',
            'v0.333.1',
            'v0.333.1-respin.1',
            'v0.333.2',
            'v0.334.0',
            'v1.0.0',
        ];
        const codes = sequence.map(storeVersionFromTag);
        for (let i = 1; i < codes.length; i += 1) {
            expect(codes[i], sequence[i]).toBeGreaterThan(codes[i - 1]);
        }
    });

    it('never collides across the representable field space', () => {
        // Sampled at the slot and band boundaries rather than exhaustively:
        // a carry bug shows up at 49 -> 50 -> 51, not in the middle of a range.
        const seen = new Map();
        for (const major of [0, 1, 209]) {
            for (const minor of [0, 1, 9, 10, 99, 100, 999]) {
                for (const patch of [0, 1, 9, 10, 99]) {
                    for (const suffix of ['', '-beta.1', '-beta.49', '-respin.1', '-respin.49']) {
                        const tag = `v${major}.${minor}.${patch}${suffix}`;
                        const code = storeVersionFromTag(tag);
                        expect(seen.has(code), `${tag} collides with ${seen.get(code)}`).toBe(false);
                        seen.set(code, tag);
                    }
                }
            }
        }
    });

    it("keeps the largest representable release under Play's ceiling", () => {
        const max = storeVersionFromTag(
            `v${MAX_MAJOR}.${MAX_MINOR}.${MAX_PATCH}-respin.${MAX_LANE_N}`,
        );
        expect(max).toBe(PLAY_VERSION_CODE_CEILING - 1);
        expect(max).toBeLessThan(PLAY_VERSION_CODE_CEILING);
        // And the next MAJOR would not, which is why the bound is 209.
        expect(() => storeVersionFromTag(`v${MAX_MAJOR + 1}.0.0`)).toThrow(/exceeds 209/);
    });
});

describe('parseTag strictness', () => {
    it('refuses spellings that would alias one store integer', () => {
        // Leading zeros: v0.333.01 and v0.333.1 would both be 3330150.
        expect(() => parseTag('v0.333.01')).toThrow(/unusable release tag/);
        expect(() => parseTag('v00.333.1')).toThrow(/unusable release tag/);
        // Lane 0 is a second spelling of the stable number.
        expect(() => parseTag('v0.333.1-beta.0')).toThrow(/numbering starts at 1/);
        expect(() => parseTag('v0.333.1-respin.0')).toThrow(/numbering starts at 1/);
    });

    it('refuses -hotfix by name, pointing at the rule that replaced it', () => {
        // It was a second mechanism for something PATCH already expressed.
        // A stale tag or a stale script deserves to be told which rule now
        // applies, not a generic parse failure.
        expect(() => parseTag('v0.333.1-hotfix.1')).toThrow(/bumps.*PATCH/s);
    });

    it('refuses tags the formula has no room for', () => {
        expect(() => parseTag('v0.1000.0')).toThrow(/MINOR 1000 exceeds 999/);
        expect(() => parseTag('v0.0.100')).toThrow(/PATCH 100 exceeds 99/);
        expect(() => parseTag('v210.0.0')).toThrow(/MAJOR 210 exceeds 209/);
        expect(() => parseTag('v0.0.0-beta.50')).toThrow(/exceeds 49/);
        expect(() => parseTag('v0.0.0-respin.50')).toThrow(/exceeds 49/);
    });

    it('refuses anything that is not a release tag', () => {
        for (const bad of [
            'v0.333',
            'v0.333.1.1',
            'v0.333.1-rc.1',
            'v0.333.1+build.7',
            'v0.333.1-beta',
            'release-0.333.1',
            'v0.333. 1',
            '',
        ]) {
            expect(() => parseTag(bad), bad).toThrow();
        }
    });

    it('refuses a non-string, rather than stringifying it', () => {
        expect(() => parseTag(undefined)).toThrow(TypeError);
        expect(() => parseTag(333)).toThrow(TypeError);
        expect(() => parseTag(null)).toThrow(TypeError);
    });

    it('trims surrounding whitespace, which is how tags arrive from shell vars', () => {
        expect(storeVersionFromTag('  v0.333.1\n')).toBe(3330150);
    });
});

describe('the strings each store shows', () => {
    it('shows beta identity on Play but never a respin', () => {
        // A respin is the same software as the stable release it re-uploads,
        // and every other shell is already shipping that string.
        expect(versionNameFromTag('v0.333.1')).toBe('0.333.1');
        expect(versionNameFromTag('v0.333.1-beta.2')).toBe('0.333.1-beta.2');
        expect(versionNameFromTag('v0.333.1-respin.1')).toBe('0.333.1');
    });

    it('gives Apple dot-separated integers only', () => {
        // CFBundleShortVersionString takes nothing else, so the beta suffix
        // has nowhere to live: on iOS the lane rides TestFlight instead.
        for (const tag of ['v0.333.1', 'v0.333.1-beta.2', 'v0.333.1-respin.1']) {
            expect(marketingVersionFromTag(tag)).toBe('0.333.1');
        }
    });

    it('canonicalizes the tag it echoes into generated files', () => {
        expect(canonicalTag('0.333.1')).toBe('v0.333.1');
        expect(canonicalTag('  v0.333.1-beta.2 ')).toBe('v0.333.1-beta.2');
    });
});

describe('artifact names', () => {
    it('gives every tag its own name, including the ones users never see', async () => {
        // Found by running the ceremony's own derivation across the three
        // lanes: a respin keeps versionName at X.Y.Z on purpose, so naming
        // artifacts after it put a respin's aab (a different versionCode,
        // therefore different bytes) on the same filename as the stable
        // release it re-uploads, in two manifests of an append-only record.
        const { artifactVersionFromTag } = await import(
            '../../../packages/mobile/scripts/version.js'
        );
        const names = ['v0.333.1', 'v0.333.1-beta.2', 'v0.333.1-respin.1']
            .map((tag) => `xchain-wallet-android-v${artifactVersionFromTag(tag)}.aab`);
        expect(new Set(names).size).toBe(names.length);
        expect(names).toEqual([
            'xchain-wallet-android-v0.333.1.aab',
            'xchain-wallet-android-v0.333.1-beta.2.aab',
            'xchain-wallet-android-v0.333.1-respin.1.aab',
        ]);
        // And each still matches the glob tools/release/expected-artifacts.txt
        // declares, so a lane suffix does not read as an undeclared artifact.
        for (const name of names) {
            expect(/^xchain-wallet-android-v.*\.aab$/.test(name), name).toBe(true);
        }
    });
});

describe('generated build files', () => {
    it('emits the two keys Gradle reads, and nothing needing escaping', () => {
        const props = versionPropertiesFor('v0.333.1');
        expect(props).toContain('versionCode=3330150');
        expect(props).toContain('versionName=0.333.1');
        expect(props.endsWith('\n')).toBe(true);
        for (const line of props.split('\n').filter(Boolean)) {
            expect(line.startsWith('#') || /^[A-Za-z]+=[\w.\-]+$/.test(line)).toBe(true);
        }
    });

    it('emits the two keys Xcode reads, carrying the same integer', () => {
        const xcconfig = versionXcconfigFor('v0.333.1');
        expect(xcconfig).toContain('MARKETING_VERSION = 0.333.1');
        expect(xcconfig).toContain('CURRENT_PROJECT_VERSION = 3330150');
        // One number, two stores: this is the drift  existed to close.
        expect(xcconfig).toContain(String(storeVersionFromTag('v0.333.1')));
    });

    it('refuses to write build files for an unusable tag', () => {
        expect(() => versionPropertiesFor('v0.333')).toThrow();
        expect(() => versionXcconfigFor('v0.333')).toThrow();
    });

    // The CLI is what the ceremony and the CI workflow actually consume, and it
    // is reached by a path the module tests never touch: `node <abs path>
    // version.js <tag>`, read with a bare shell `read`. It stopped working
    // during the first real release ceremony and the failure had the worst
    // possible shape - exit 0, nothing on stdout - so the ceremony blamed the
    // TAG ("could not derive a versionCode from v0.335.0") for a path problem.
    //
    // Cause: the entry-point test compared `import.meta.url`, which is always
    // the REAL path, against `process.argv[1]`, which is whatever the caller
    // typed. Under any symlink they differ and `main` never runs. macOS makes
    // that the default rather than the exotic case, because `/tmp` is a symlink
    // to `/private/tmp` and a release worktree in the obvious place is
    // therefore symlinked.
    describe('the CLI the ceremony actually calls', () => {
        // Resolved from cwd rather than from `import.meta.url`: under vitest's
        // transform that is not a file: URL, and the point of these three cases
        // is to run the REAL file the way a shell does.
        const script = join(process.cwd(), 'packages/mobile/scripts/version.js');
        const run = (path, ...args) => execFileSync(process.execPath, [path, ...args], { encoding: 'utf8' }).trim();

        it('prints exactly two fields by absolute path, which is how the ceremony calls it', () => {
            expect(run(script, 'v0.333.1').split(/\s+/)).toEqual(['3330150', '0.333.1']);
        });

        it('prints the same thing THROUGH A SYMLINK, which is where it silently failed', () => {
            const link = join(mkdtempSync(join(tmpdir(), 'xc-version-cli-')), 'link');
            symlinkSync(dirname(script), link, 'dir');
            try {
                // The assertion that matters is not equality but non-emptiness:
                // the bug printed NOTHING and exited 0, so a test that only
                // compared parsed output would have passed on undefined.
                const out = run(join(link, 'version.js'), 'v0.333.1');
                expect(out).not.toBe('');
                expect(out.split(/\s+/)).toEqual(['3330150', '0.333.1']);
            } finally {
                rmSync(dirname(link), { recursive: true, force: true });
            }
        });

        it('--artifact still prints ONE field, since a bare read would glue a third on', () => {
            expect(run(script, 'v0.333.1', '--artifact').split(/\s+/)).toHaveLength(1);
        });
    });
});
