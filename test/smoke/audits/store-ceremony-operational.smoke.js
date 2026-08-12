// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every store submission ceremony has to stay executable, on EVERY lane.
//
// WHY THIS EXISTS, AND WHY IT IS NOT PART OF THE EXTENSION GATE. The
// extension gate (extension-ceremony-collateral.smoke.js) was created for
// exactly this failure: the docs port rendered the Chrome ceremony as
// evergreen prose and the page came out with 0 of its 40 checkable steps and
// 0 of its 8 command blocks. That gate then held ONE page, named by a
// literal, and the Android page went the same way unnoticed a day later,
// measured at 0 checkable steps and 0 fenced blocks against a runbook that
// had 5 command blocks and phases the port dropped whole (creating the app
// record, and arming release parity in the release's own commit).
//
// So the rule was right and the mechanism was narrower than the rule, which
// is the same shape as the release-CI heap guard that iterated two workflow
// filenames while promising to cover every shell. The fix is the same fix:
// ENUMERATE the store pages rather than listing them, and refuse a page that
// has no declared floor, so a new store lane joins this gate by existing
// instead of by somebody remembering to add it.
//
// The floors are per-page minimums, not equalities: a page may grow freely.
// A page that genuinely shrinks (a phase retired, a command replaced by a
// script) lowers its floor DELIBERATELY, in the same change, with a reason.

import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';

import { docsPath, readDoc, skipUnlessDocs } from '../_docs-repo.js';

skipUnlessDocs('store ceremony operational-character smoke');

// Declared floors, keyed by the page's path under the wallet docs root.
// `steps` counts ⬜/✅ at line start (the repo convention, never a GFM
// checkbox). `blocks` counts fenced blocks: commands an operator runs, plus
// any block of values transcribed verbatim into a console form.
const FLOORS = {
    'release/extension/chrome-web-store.md': {
        steps: 50,
        blocks: 5,
        note: 'restored 2026-08-03 after the docs port scrubbed it to 0/0',
    },
    'release/mobile/android-play.md': {
        steps: 10,
        blocks: 13,
        note: 'restored 2026-08-03 after the same port scrubbed it to 0/0; the blocks are the '
            + 'ceremony invocation, two manifest dumps, the two Phase 0 preflight scripts, the '
            + 'permission set, the asset-links build, the App Links check, the publisher, the '
            + 'signature one-liner, the shipped-lanes flip and the character count. Raised from '
            + '9/12, which added the trader block an operator transcribes and the step'
            + 'that ticks it off. The page carries more than this today; the floor moves only by '
            + 'what a change actually put there, so it cannot be propped up by a neighbour\'s '
            + 'uncommitted work',
    },
    'release/desktop/snap-store.md': {
        steps: 26,
        blocks: 7,
        note: 'written 2026-08-03 with the lane, rather than after it: the blocks are the name '
            + 'registration, the credential export, the opt-in build, the sandbox-declaration check, '
            + 'the test-channel upload, the interface connect and the stable promotion. The floor is '
            + 'high on purpose because three of its steps are permanent (a first-come name, a stable '
            + 'revision that auto-refreshes to every install, and a confinement choice that decides '
            + 'whether review stays automatic)',
    },
    // ---- KNOWN GAPS, DECLARED RATHER THAN HIDDEN -----------------------
    //
    // Everything below is at 0 and should not be. Enumerating the whole
    // directory (2026-08-03) found that only TWO of the twelve release pages
    // carry a checkable step at all, and the two store ceremonies among these
    // are both launch-gating lanes in their own right.
    //
    // A floor of 0 asserts nothing about quality. It exists so the page is
    // ENUMERATED and cannot be mistaken for covered, and so that raising it
    // is a one-line change when the owning lane restores its ceremony. These
    // are deliberately NOT fixed from here: each belongs to a separate
    // submission spec with its own operator decisions, and inventing another
    // lane's ceremony from this side would be guessing at exactly the steps
    // whose whole value is being right.
    'release/mobile/ios-app-store.md': {
        steps: 44,
        blocks: 5,
        note: 'GAP CLOSED 2026-08-03. The port left this page at 0/0 and the pre-migration'
            + 'runbook it came from had no checkable steps either, so this is the ceremony made '
            + 'operational rather than restored: the phases were already right and were not '
            + 'followable. The five blocks are the privacy-URL check, the archive and export '
            + 'invocations, the native-console reader, the trader block an operator transcribes, and '
            + 'the unauthenticated apple-app-site-association fetch',
    },
    'release/desktop/mac-app-store.md': {
        steps: 26,
        blocks: 1,
        note: 'GAP CLOSED 2026-08-03 by the lane that owned it. The one block is the opt-in build; '
            + 'the rest of this ceremony is console work and physical hardware, which is exactly why '
            + 'its step count is high and its command count is not. Phase 1 is first on purpose: '
            + 'whether a sandboxed build reaches a hardware wallet decides whether the channel ships '
            + 'at all, and it is answerable from a development certificate, before the full set exists',
    },
    'release/desktop/microsoft-store.md': {
        steps: 23,
        blocks: 1,
        note: 'GAP CLOSED 2026-08-03 by the lane that owned it. The one block is the opt-in build with '
            + 'its two account-assigned identity values; Phase 2 is a whole phase because all three of '
            + 'its settings build successfully and fail at ingestion instead, and the publisher string '
            + 'fails that way even when it is simply left unset',
    },
    'release/desktop/windows.md': { steps: 0, blocks: 0, note: 'distribution lane, not a store ceremony' },
    'release/desktop/macos.md': { steps: 0, blocks: 0, note: 'distribution lane, not a store ceremony' },
    'release/desktop/linux.md': { steps: 0, blocks: 0, note: 'distribution lane, not a store ceremony' },
    'release/extension/test-dapp-runbook.md': {
        steps: 0,
        blocks: 3,
        note: 'a runbook with commands but no checkable steps; owned by the extension lane',
    },
    'release/ci-setup.md': { steps: 0, blocks: 0, note: 'reference, not a ceremony' },
    'release/verify-release.md': {
        steps: 0,
        blocks: 10,
        note: 'reader-facing verification commands; the commands are the point, the steps are not',
    },
    // Named a checklist, and it has no checkable item in it. Registered here
    // rather than fixed, for the same reason as the store gaps above.
    'release/qa-checklist.md': {
        steps: 0,
        blocks: 0,
        note: 'KNOWN GAP: a document called a checklist that carries zero checkable items',
    },
};

// Enumerate rather than list: every markdown page under release/, at the root
// and one level down, except the lane index README. Walking only the
// subdirectories would have left the three root pages declared but never
// read, which is the same silent-hole bug this gate exists to catch, so it
// walks both and then proves below that nothing was declared in vain.
const storePages = [];
for (const entry of readdirSync(docsPath('release'), { withFileTypes: true })) {
    if (entry.isDirectory()) {
        for (const file of readdirSync(docsPath('release', entry.name))) {
            if (!file.endsWith('.md') || file.toLowerCase() === 'readme.md') continue;
            storePages.push(`release/${entry.name}/${file}`);
        }
    } else if (entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md') {
        storePages.push(`release/${entry.name}`);
    }
}

assert.ok(storePages.length >= 3,
    `found only ${storePages.length} store pages under release/, which is fewer than the three that `
    + 'exist (Chrome, Android, iOS). Either the enumeration broke or pages moved; both mean this gate '
    + 'is watching nothing.');

// No declaration may rot, and this is checked FIRST, before anything reads a
// page by name. A floor for a page the enumeration never reaches (renamed,
// moved, deleted) silently stops applying, which is the same silent hole as
// an unlisted page arriving from the other direction. Ordering matters here
// for a reason found by testing it: with this check placed last, a rename
// crashed a later read with a raw ENOENT stack instead of saying what was
// wrong, which is a worse failure than the one being guarded.
for (const declared of Object.keys(FLOORS)) {
    assert.ok(storePages.includes(declared),
        `this gate declares a floor for ${declared}, but the enumeration never found that page. A `
        + 'declaration that matches nothing is not protecting anything: the page was renamed, moved '
        + 'or deleted, and its floor stopped applying without anything going red. Point the '
        + 'declaration at the page\'s new path, or drop it if the page is genuinely gone.');
}

const stepsIn = (text) => (text.match(/^[⬜✅]/gm) || []).length;
const blocksIn = (text) => (text.match(/^\s*```/gm) || []).length / 2;

for (const page of storePages) {
    const floor = FLOORS[page];

    // The load-bearing half: an undeclared page is a FAILURE, not a skip.
    // This is what makes the gate cover a lane nobody remembered to add.
    assert.ok(floor,
        `${page} is a store ceremony page with no declared floor in this gate, so nothing is holding `
        + 'it to being executable. That is exactly how the Android page reached 0 checkable steps and '
        + '0 commands without anything going red. Add an entry to FLOORS with the counts the page '
        + 'actually carries today, and a note saying what they are.');

    assert.ok(existsSync(docsPath(...page.split('/'))), `${page} vanished between enumeration and read`);
    const text = readDoc(...page.split('/'));

    const steps = stepsIn(text);
    assert.ok(steps >= floor.steps,
        `${page} carries ${steps} checkable steps, below its declared floor of ${floor.steps} `
        + `(${floor.note}). A submission ceremony with irreversible and ordering-sensitive actions is `
        + 'followed step by step or it is improvised. If the ceremony genuinely shrank, lower the '
        + 'floor in this same change and say why.');

    const blocks = blocksIn(text);
    assert.ok(blocks >= floor.blocks,
        `${page} carries ${blocks} fenced blocks, below its declared floor of ${floor.blocks} `
        + `(${floor.note}). Prose describing a command is not a command: an operator cannot paste a `
        + 'sentence into a terminal, and a value that is only described is a value they guess.');
}

// ---- THE PHASE SPINE ------------------------------------------------------
//
// Counting steps and blocks measures a page's CHARACTER, never its
// COMPLETENESS, and a page can sit comfortably above both floors while a whole
// phase is simply absent. That has now happened twice on the same page with
// this gate green: the docs port dropped the Android page's Phase 2a and Phase
// 8 whole (restored 2026-08-03), and on 2026-08-04 the console showed that the
// page had never carried the review submission at all - a step nothing in the
// console prompts for, so a lane driven from the page alone sits unreviewed
// while every track promotion appears to succeed.
//
// So the phase spine is declared and checked. A page joins by EXISTING: any
// page that numbers its phases at all must declare them here, which is the
// same rule the floors use and for the same reason. `first`/`last` are the
// page's own end phases and every integer between them must appear, so a gap
// and a lost tail both go red; `sub` names the lettered sub-phases, which
// numbering alone cannot see.
//
// Stated limit: this catches a missing PHASE, not a missing step inside one.
// It is deliberately not a table of contents - the point is that dropping a
// unit of the ceremony costs an edit here, in the same change, with a reason.
const PHASES = {
    'release/mobile/android-play.md': {
        first: 0, last: 8, sub: ['2a', '2b', '3a', '3b'],
        note: '3a/3b added 2026-08-04: managed publishing, then the review submission',
    },
    'release/extension/chrome-web-store.md': { first: 0, last: 8, sub: ['2a', '2b', '2c', '4a', '4b'] },
    'release/mobile/ios-app-store.md': {
        first: 1, last: 8, sub: [],
        note: 'starts at 1 rather than 0, which is why the first phase is declared and not assumed',
    },
    'release/desktop/mac-app-store.md': { first: 0, last: 5, sub: [] },
    'release/desktop/microsoft-store.md': { first: 0, last: 5, sub: [] },
    'release/desktop/snap-store.md': { first: 0, last: 6, sub: [] },
};

for (const declared of Object.keys(PHASES)) {
    assert.ok(storePages.includes(declared),
        `this gate declares a phase spine for ${declared}, which the enumeration never found. A `
        + 'declaration that matches nothing protects nothing.');
}

for (const page of storePages) {
    const text = readDoc(...page.split('/'));
    const numbered = [...text.matchAll(/^#{3,4} Phase (\d+)/gm)].map((m) => Number(m[1]));
    const spine = PHASES[page];

    if (!numbered.length) {
        assert.ok(!spine,
            `this gate declares a phase spine for ${page}, but the page numbers no phases at all. `
            + 'Either the ceremony was rewritten without phases, or it was scrubbed.');
        continue;
    }

    assert.ok(spine,
        `${page} numbers its phases but declares no spine in this gate, so a phase can vanish from it `
        + 'without anything going red. That is how the Android page lost two phases whole in the docs '
        + 'port while its step count stayed above its floor. Add an entry to PHASES with the first and '
        + 'last phase the page carries today, and any lettered sub-phases.');

    for (let n = spine.first; n <= spine.last; n += 1) {
        assert.ok(numbered.includes(n),
            `${page} is missing Phase ${n}, which its declared spine (${spine.first}-${spine.last}) `
            + 'requires. A ceremony phase does not go missing harmlessly: the steps it carried are '
            + 'the ones nobody will improvise, because nothing downstream announces their absence. '
            + 'If the phase was genuinely retired, move the spine in this same change and say why.');
    }

    for (const label of spine.sub) {
        assert.match(text, new RegExp(`^#### ${label}[.:]`, 'm'),
            `${page} is missing sub-phase ${label}, which its declared spine requires. A lettered `
            + 'sub-phase is invisible to the phase numbering, so losing one leaves the spine intact '
            + 'and the ceremony short.');
    }
}

// The irreversible steps are the ones worth naming individually, because
// their cost is not "a rerun" but "a permanent answer". Each of these was a
// live trap on its own lane: a permanent free-or-paid choice, a version code
// Play accepts exactly once, and a signing key that can never be rotated.
const IRREVERSIBLE = {
    'release/mobile/android-play.md': [
        [/free or paid/i, 'the permanent free-or-paid choice at app creation'],
        [/io\.xchain\.wallet\.android/, 'the package name, which is immutable once published'],
        [/version ?code/i, 'the version code, which Play accepts exactly once'],
        [/never be rotated|can never be rotated/i, 'that the direct-distribution key cannot be rotated'],
    ],
    // Added 2026-08-03 with the iOS ceremony. Same rule as Android's,
    // and the page could not be held to it while it had no steps to hold.
    'release/mobile/ios-app-store.md': [
        [/io\.xchain\.wallet\.ios/, 'the bundle identifier, pinned publicly the moment the app record exists'],
        [/build number/i, 'the build number, which App Store Connect accepts exactly once'],
        [/no rollback/i, 'that the App Store has no rollback, only another review cycle'],
        [/permanently and publicly/i, 'that the trader declaration publishes permanently and publicly'],
    ],
};

for (const [page, checks] of Object.entries(IRREVERSIBLE)) {
    assert.ok(storePages.includes(page),
        `this gate checks ${page} for its irreversible-step warnings, but the enumeration never found `
        + 'that page. Point this entry at its new path rather than leaving the warnings unchecked.');
    const text = readDoc(...page.split('/'));
    for (const [pattern, what] of checks) {
        assert.ok(pattern.test(text),
            `${page} no longer warns about ${what}. Irreversible steps are the reason this ceremony is `
            + 'a document rather than a habit; losing the warning costs a permanent answer, not a rerun.');
    }
}

// ----------------------------------------------------------------------
// A ceremony page has to describe the MACHINE, not just the commands.
//
// Found by running the Android ceremony from the page rather than from
// memory, in the fresh detached worktree the ceremony itself prescribes. It
// stopped twice before producing anything: once on `apksigner not found`,
// and once minutes later inside the package manager on a missing build tool,
// because a fresh worktree has no installed dependencies. Neither was
// discoverable from the page - it carried zero mentions of the JDK, the SDK,
// build-tools or bundletool - and the frontier had recorded this wiring as
// "now in the runbook" for a day while the runbook did not have it.
//
// The tools are DERIVED from the script's own preflight rather than listed
// here, so adding a `command -v` requirement to a ceremony and forgetting the
// page turns this red on its own. That is the whole point: every previous
// version of this class of bug was a mechanism scoped narrower than its rule.
const CEREMONY_TOOLCHAINS = {
    'android-ceremony.sh': {
        page: 'release/mobile/android-play.md',
        enforce: true,
        note: 'the Android submission ceremony; its operator page is restored and current',
    },
    // Declared and not enforced, each with a reason. A floor of "not
    // enforced" asserts nothing about quality; it exists so the script is
    // ENUMERATED and cannot be mistaken for covered.
    'lib.sh': {
        enforce: false,
        note: 'a shared library, not an operator entry point: nobody runs it from a page',
    },
    'sign.sh': {
        enforce: false,
        note: 'KNOWN GAP: the signing step needs gpg and git and no operator page states that; '
            + 'owned by the release-key lane, which has not run its key ceremony yet',
    },
    'verify.sh': {
        enforce: false,
        note: 'reader-facing verification, documented on release/verify-release.md as commands rather '
            + 'than as a machine to set up',
    },
    'prepare-resign-tag.sh': {
        enforce: false,
        note: 'Cuts the tag a published release is RE-SIGNED from. Its only requirement is'
            + 'git, on a machine that is already a checkout of this repo - the script reads its own '
            + 'location to find the source tree, so an operator cannot reach it without git. '
            + 'Documented in tools/release/README.md ("Re-signing a release that was already '
            + 'published") beside the sign.sh invocation it hands over to, rather than on an operator '
            + 'page: it is a maintainer repair, not a store ceremony step',
    },
    'verify-release-key.sh': {
        enforce: false,
        note: 'maintainer key-ceremony verification. Its only requirement is gpg, which is the whole '
            + 'subject of the ceremony runbook that invokes it, so an operator cannot reach this '
            + 'script without already having gpg. Documented in the GPG key ceremony runbook '
            + '(claude/reports/, private by design) rather than on a public docs page, because it '
            + 'names key custody. Registered here rather than left undeclared: this gate refused it '
            + 'on sight the moment it was added, which is the gate doing its job',
    },
    'verify-store.sh': {
        enforce: false,
        note: 'reader-facing verification, same as verify.sh',
    },
};

const releaseScripts = readdirSync(new URL('../../../tools/release/', import.meta.url))
    .filter((name) => name.endsWith('.sh'))
    .sort();

assert.ok(releaseScripts.length >= 5,
    `found only ${releaseScripts.length} release scripts, which is fewer than exist. Either the `
    + 'enumeration broke or the directory moved; both mean this gate is watching nothing.');

for (const declared of Object.keys(CEREMONY_TOOLCHAINS)) {
    assert.ok(releaseScripts.includes(declared),
        `this gate declares a toolchain entry for ${declared}, but the enumeration never found that `
        + 'script. A declaration that matches nothing protects nothing: point it at the new name, or '
        + 'drop it if the script is genuinely gone.');
}

let enforced = 0;
for (const script of releaseScripts) {
    const source = readFileSync(new URL(`../../../tools/release/${script}`, import.meta.url), 'utf8');

    // The requirements the script itself declares. `command -v X || die` is
    // how every one of these is written, so this reads the real contract
    // rather than a copy of it that can drift.
    const tools = [...source.matchAll(/command -v ([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    const uniqueTools = [...new Set(tools)];
    if (uniqueTools.length === 0) continue;

    const entry = CEREMONY_TOOLCHAINS[script];

    // The load-bearing half: an undeclared script is a FAILURE, not a skip.
    assert.ok(entry,
        `tools/release/${script} preflights for [${uniqueTools.join(', ')}] and this gate has no entry `
        + 'for it, so nothing is checking that an operator can find out they need them. Add an entry '
        + 'naming the page that documents its machine, or say why it needs none.');

    if (!entry.enforce) continue;
    enforced += 1;

    const text = readDoc(...entry.page.split('/'));
    for (const tool of uniqueTools) {
        assert.ok(new RegExp(`\\b${tool}\\b`, 'i').test(text),
            `tools/release/${script} refuses to run without \`${tool}\`, and ${entry.page} never `
            + `mentions it (${entry.note}). An operator on a fresh release worktree finds this out `
            + 'when the ceremony stops, which is the moment they can least afford to go hunting. '
            + 'Name it in the phase that runs the script.');
    }

    // Two requirements the script cannot express as `command -v`, and both
    // stopped a real run. bundletool is passed by path rather than found on
    // the path; the workspace install is a state of the directory.
    assert.ok(/bundletool/i.test(text),
        `${entry.page} never mentions bundletool, and tools/release/${script} refuses without it. `
        + 'It is passed by path, so it cannot be discovered the way a command on the path can be.');
    assert.ok(/node_modules|pnpm install/i.test(text),
        `${entry.page} never tells the operator to install the workspace. A release worktree is `
        + 'normally a FRESH one - that is what the clean-tree rule pushes people to - and a fresh '
        + 'worktree has no dependencies, so the build dies minutes in with an error naming a build '
        + 'tool instead of the real cause.');
}

assert.ok(enforced >= 1,
    'no ceremony toolchain was actually enforced, so this whole section proved nothing. At least one '
    + 'entry must have enforce: true.');

console.log(`store-ceremony-operational: ${storePages.length} release pages enumerated, all at or above `
    + `their declared operational floor; ${Object.keys(FLOORS).length} declarations, all reachable; `
    + `${releaseScripts.length} release scripts enumerated, ${enforced} toolchain(s) enforced`);
