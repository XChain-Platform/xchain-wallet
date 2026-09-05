// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Universal Link claim drift, across the repo boundary.
//
// The path range a tapped https link travels through is decided in FOUR files
// that live in TWO repos, and every one of them was individually defensible
// while the path was broken end to end:
//
//   xchain-websites  xchain.io/build/aasa.build.js   CLAIMED_PATH
//       what iOS is told to hand the app, and equally what every browser
//       WITHOUT the app is promised will load as an ordinary page.
//   xchain-wallet    AndroidManifest.xml             android:pathPrefix
//       the same claim again, in Android's spelling.
//   xchain-wallet    packages/core/src/uri/xchainUri.js  WEB_LINK_PREFIX
//       the range the SPA will actually unwrap and act on.
//   xchain-websites  xchain.io/wallet/link/index.html
//       what the promise resolves to when the app is not installed.
//
// Each pair can drift silently, and each drift is invisible from inside its own
// repo:
//
//   claim WIDER than the parser  -> the OS takes the URL away from the browser
//       and hands it to an app that drops it. The app surfaces on its default
//       view, the page never loads, and nothing anywhere reports an error. This
// is the shape found on the Android side, where the claim read
//       `/wallet` and swallowed the `/wallet/privacy/` and `/wallet/support/`
//       URLs that BOTH store listings publish - so a reviewer tapping the
//       privacy link from the listing got the wallet instead of the policy.
//   claim NARROWER than the parser -> the SPA is ready for links the OS will
//       never deliver, which reads as "deep links do not work on iOS" with
//       nothing broken in either file.
//   claim moved with no page under it -> `https://xchain.io/wallet/link/...`
//       returns 404 to every device without the app. That was the live state
// when was found.
//
// Universal Links are one of the six native integrations that answer App Store
// guideline 4.2 (§2.1), so this is not cosmetic: a reviewer taps a link
// and watches the minimum-functionality defence fail in front of them.
//
// WHY THE ASSERTIONS ARE BEHAVIOURAL. Comparing the two constants as strings
// catches a rename and nothing else. What matters is whether the SET OF URLS
// the association hands over is the SET OF URLS the parser acts on, so the
// claim is compiled to Apple's own wildcard rule, the parser is imported and
// really run, and the two answers are compared per URL. Constants are compared
// too, because that is the failure message a person can act on.
//
// WHERE THIS RUNS, AND WHERE IT DOES NOT. The sibling websites checkout is
// present in a full monorepo working tree and absent from an isolated
// single-repo checkout, so this file skips there. That skip is a printed
// message and an exit 0, which the smoke runner scores as a PASS, and
// xchain-websites is not declared in .ci-siblings and is cloned by no workflow
// under .github/, so this file has never executed on a wallet CI run. Read the
// skip as "nothing was compared", never as coverage.
//
// It cannot simply be armed the way _docs-repo.js is: xchain-documentation is a
// public repo an anonymous checkout resolves, and xchain-websites is private, so
// declaring it in .ci-siblings without a working clone would only convert this
// silence into a hard failure of the whole gate.
//
// The CI-ENFORCED copy of this comparison therefore lives on the other side of
// the seam, in xchain-websites/test/apple-app-site-association.test.js, whose
// venue does clone THIS repo and sets XCHAIN_REQUIRE_SIBLINGS=1 so the check
// fails rather than skips. This file stays as the local platform-tree gate and
// as the behavioural half, which imports the real parser; keep the two in step.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');                       // xchain-wallet

// Resolved from this file's own location, never cwd. XCHAIN_WEBSITES_ROOT
// overrides it when the sibling lives somewhere other than beside this repo.
const WEBSITES_ROOT = process.env.XCHAIN_WEBSITES_ROOT || join(root, '..', 'xchain-websites');
const AASA_BUILD = join(WEBSITES_ROOT, 'xchain.io', 'build', 'aasa.build.js');

if (!existsSync(AASA_BUILD)) {
    console.log('SKIP: universal-link-claim-drift smoke - NOTHING WAS COMPARED. The association generator is '
        + `not in this checkout; it lives in the sibling xchain-websites repo (expected at ${AASA_BUILD}). `
        + 'Clone it beside this one, or set XCHAIN_WEBSITES_ROOT, to run this gate. The claim-parity half is '
        + 'gated in CI from the other side, by xchain-websites/test/apple-app-site-association.test.js.');
    process.exit(0);
}

// The generator is CommonJS and reads nothing at load time (its emit() is
// behind a require.main guard), so requiring it is side-effect free and gets
// the EXPORTED constant rather than a second copy of the literal.
const aasa = createRequire(import.meta.url)(AASA_BUILD);

// --- 1. The claim, compiled to Apple's matching rule --------------------
//
// In an association file's `components`, the `/` value is a pattern over the
// path: `*` matches any sequence of characters and `?` matches exactly one.
// Applying the real rule rather than a startsWith is the difference between
// noticing and not noticing that `/wallet/link*` also claims `/wallet/linkage/`.
const claimed = aasa.CLAIMED_PATH;
assert.equal(typeof claimed, 'string', 'the association generator no longer exports CLAIMED_PATH');

function claimMatcher(pattern) {
    const source = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
    const re = new RegExp(source);
    return (path) => re.test(path);
}
const claims = claimMatcher(claimed);

// --- 2. The claim and the parser, as constants --------------------------
//
// Read out of the source because WEB_LINK_PREFIX is module-private, the same
// way the iOS smoke reads the plugin's jsName. This assertion exists for its
// failure message: the behavioural comparison below fails on the same drift,
// but names URLs rather than the two lines someone has to go and change.
const uriSource = readFileSync(join(root, 'packages', 'core', 'src', 'uri', 'xchainUri.js'), 'utf8');
const parserPrefix = /WEB_LINK_PREFIX\s*=\s*'([^']+)'/.exec(uriSource)?.[1];
assert.ok(parserPrefix, 'xchainUri.js no longer states its web-link prefix as WEB_LINK_PREFIX');
assert.equal(
    claimed, `${parserPrefix}*`,
    `the association claims ${claimed} and the SPA unwraps ${parserPrefix}*. Every URL in the gap is a link iOS `
    + 'takes away from the browser and hands to an app that discards it, or a link the SPA is ready for and iOS '
    + 'never delivers. Both look like "deep links are broken" with every individual file correct.',
);

// The Android twin. assetlinks.json carries no paths, so this attribute is the
// whole Android scope, and iOS and Android claiming different ranges means the
// same link behaves differently per platform for reasons no one can see.
const manifest = readFileSync(
    join(root, 'packages', 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8',
);
const manifestPrefix = /<data android:scheme="https" android:host="xchain\.io" android:pathPrefix="([^"]+)" \/>/
    .exec(manifest)?.[1];
assert.ok(manifestPrefix, 'no https App Link data element with a pathPrefix on xchain.io');
assert.equal(
    manifestPrefix, parserPrefix,
    `the Android manifest claims ${manifestPrefix} while the association claims ${claimed}; the two platforms `
    + 'would deliver different sets of URLs from the same printed link',
);

// --- 3. The claim and the parser, as behaviour --------------------------
//
// Path dimension only: the payload is held fixed at a valid envelope so the
// comparison isolates WHICH PATHS travel, not which payloads are honoured. A
// claimed path with no `uri` parameter is a legitimate no-op (that is the
// landing page's own case) and would make a per-URL equality meaningless.
const { parseXchainUri } = await import(
    new URL('../../../packages/core/src/uri/xchainUri.js', import.meta.url).href
);
const PAYLOAD = `?uri=${encodeURIComponent('xchain:TBTC/receive?amount=1')}`;
const actsOn = (path) => parseXchainUri(`https://xchain.io${path}${PAYLOAD}`).kind !== 'unknown';

// Named so a failure says which URL and why it matters, not just "path 3".
const PATHS = [
    ['/wallet/link/', 'the canonical web link; if this is not claimed and acted on, nothing else matters'],
    ['/wallet/link/v1/invoice/9', 'a versioned deep path: the claim is a wildcard and deeper paths must travel'],
    ['/wallet/link', 'the bare directory with no trailing slash, which neither side claims'],
    ['/wallet/linkage/x', 'the adjacent-name trap a `/wallet/link*` claim would swallow'],
    ['/wallet/privacy/', 'published by BOTH store listings; a reviewer taps it expecting the policy'],
    ['/wallet/support/', 'published by BOTH store listings; the support URL a reviewer checks'],
    ['/wallet/download/', 'the page that tells someone how to install the app must not need the app'],
    ['/', 'the marketing home page'],
    ['/explorer.html', 'an ordinary site page that must stay in the browser'],
];
for (const [path, why] of PATHS) {
    assert.equal(
        claims(path), actsOn(path),
        `https://xchain.io${path} is ${claims(path) ? 'claimed by the association' : 'left to the browser'} and `
        + `${actsOn(path) ? 'acted on' : 'discarded'} by the SPA - ${why}`,
    );
}
// Guards the loop above: an equality holds trivially if both sides answer false
// for everything, which is exactly what a broken matcher or a parser import
// that silently returned `unknown` would produce.
assert.ok(
    claims('/wallet/link/') && actsOn('/wallet/link/'),
    'neither side claims the canonical link, so the comparison above proved nothing',
);

// The JS intake gate in front of the parser (nativeDeepLinks.js) is the fifth
// copy of the claim, and it must be the SAME range - neither narrower nor
// wider.
//
// Narrower is the loud half: a link the OS delivers and this gate drops never
// reaches the parser at all, which is the silent nothing this whole file
// exists to prevent. Wider was allowed here on the reasoning that the
// OS is the narrower filter anyway, and that tolerance is exactly what let the
// gate sit at `/wallet` for the whole life of the narrowing - claiming
// `/wallet/privacy/` and `/wallet/support/` in a file whose own docstring says
// it accepts "the link shapes this app claims in its manifest, and nothing
// else". The OS is not the only way in either: an Android intent can be fired
// at the activity directly by any app on the device, and the Java and Swift
// plugins check the HOST only, so this constant is the path filter on that
// route.
const deepLinkSource = readFileSync(
    join(root, 'packages', 'web', 'src', 'deeplinks', 'nativeDeepLinks.js'), 'utf8',
);
const gatePrefix = /ALLOWED_HTTPS_PREFIX\s*=\s*'([^']+)'/.exec(deepLinkSource)?.[1];
assert.ok(gatePrefix, 'nativeDeepLinks.js no longer states its accepted https path prefix');
assert.equal(
    gatePrefix, parserPrefix,
    `the native intake gate accepts ${gatePrefix} while the association hands over ${claimed} and the parser `
    + `unwraps ${parserPrefix}. A narrower gate drops links inside the claim before the parser ever sees them; a `
    + 'wider one admits paths neither platform claims, which is how this constant went stale unnoticed.',
);

// --- 4. The half that runs when the app is ABSENT -----------------------
//
// A claimed path is a promise to two audiences at once, and the second one is
// every device in the world without the wallet installed. The serving rule for
// the wildcard is asserted in the websites repo (test/wallet-link-landing.test.js);
// what belongs here is that a prefix moved on THIS side does not leave the page
// behind, because that edit is made in this repo and its 404 lands in that one.
const claimedDir = claimed.replace(/\*$/, '').replace(/^\//, '').split('/').join(sep);
const landing = join(WEBSITES_ROOT, 'xchain.io', claimedDir, 'index.html');
assert.ok(
    existsSync(landing),
    `the association claims ${claimed} and nothing in the websites docroot serves it (looked for ${landing}). A `
    + 'device without the app gets whatever that path returns, and a 404 is what a store reviewer following a '
    + 'published link would see.',
);

// The association file must be generated into the docroot of the host the
// entitlement names. iOS fetches it from that host and nowhere else, so an
// output path under some other site directory is a link claim that no device
// ever learns about.
const entitlements = readFileSync(
    join(root, 'packages', 'mobile', 'ios', 'App', 'App', 'App.entitlements'), 'utf8',
);
const entitlementDomain = /<string>applinks:([^<]+)<\/string>/.exec(entitlements)?.[1];
assert.ok(entitlementDomain, 'the iOS entitlements no longer name an applinks domain');
assert.ok(
    aasa.OUT_FILE.includes(`${sep}${entitlementDomain}${sep}.well-known${sep}`),
    `the entitlement associates ${entitlementDomain} but the association file is generated at ${aasa.OUT_FILE}; `
    + 'iOS fetches /.well-known/apple-app-site-association from the associated host only',
);

console.log(
    `OK: universal-link claim drift (the association's ${claimed} and the SPA's ${parserPrefix} cover the`
    + ' same URLs, checked by Apple\'s own wildcard rule against the real parser and not by comparing strings; the'
    + ' Android manifest claims the same range; the store listings\' privacy, support and download URLs are'
    + ' claimed by neither side; the native intake gate claims exactly the same range; the claimed path has a'
    + ' landing page in the websites docroot for devices without the app; and the association is generated into'
    + ` the docroot of ${entitlementDomain}, the host the entitlement associates)`,
);
