// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wire audit: every host the shipped wallet can contact, and on which
// shell (§2.6, §5, privacy policy).
//
// This exists because three documents have to agree with each other AND with
// the code, forever: Apple's privacy nutrition labels, Play's Data safety
// form, and the published privacy policy. A mismatch is a rejection class
// before approval and a removal class after it, and the failure mode is not
// dishonesty - it is a gateway constant added in a flow module two years from
// now by someone who has never read a store form.
//
// So the list lives HERE, in code, next to nothing else, and the store
// documents cite it rather than restating it. `test/unit/mobile/wireAudit.test.js`
// then reads the modules that actually egress and fails if any of them names a
// host this list does not, which is the only way a document like this stays
// true without someone remembering to re-derive it.
//
// What this list is NOT: a list of every URL in the codebase. Link targets
// (`<a href>` to a block explorer), licence URLs, and demo-data URLs are not
// egress - nothing is requested until a user taps, and a tap opens the system
// browser, which is the browser's contact, not the app's. Only automatic,
// app-initiated requests are registered.

/**
 * @typedef {object} EgressEntry
 * @property {string} host                    the hostname contacted (default host, where the endpoint is user-configurable)
 * @property {'first' | 'third'} party        who operates it
 * @property {string} why                     the user-visible reason the request exists
 * @property {string} carries                 what leaves the device, stated plainly
 * @property {string} control                 how a user stops it: 'none', a settings path, or the structural reason it cannot happen
 * @property {string[]} shells                shells on which the request actually occurs
 * @property {string} source                  the module that names the host
 */

/** Every shell that ships. `mobile` covers both store targets; they share the SPA. */
export const SHELLS = Object.freeze(['web', 'desktop', 'extension', 'mobile']);

/**
 * Hosts the app contacts automatically, by shell.
 *
 * Ordered first-party first, then third-party, then the entries that are
 * registered precisely BECAUSE they do not egress on mobile: a reader
 * comparing this to the privacy policy needs to see why a host named there is
 * absent from the iOS labels, and an empty `shells` array says it out loud.
 *
 * @type {readonly EgressEntry[]}
 */
export const WIRE_AUDIT = Object.freeze([
    {
        host: 'explorer.xchain.io',
        party: 'first',
        why: 'balances, transaction history, token rows, fee quotes',
        carries: 'the addresses being queried, and the requesting IP',
        control: 'Settings › Networks (the endpoint is user-configurable)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/registry/descriptors/',
    },
    {
        host: 'encoder.xchain.io',
        party: 'first',
        why: 'builds the unsigned transaction the device then signs',
        carries: 'transaction inputs: addresses, amounts, ticks, and the requesting IP',
        control: 'Settings › Networks (the endpoint is user-configurable)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/registry/descriptors/',
    },
    {
        host: 'hub.xchain.io',
        party: 'first',
        why: 'signed chain-registry snapshot, fee data, SPV checkpoints',
        carries: 'the requesting IP; no addresses',
        control: 'Settings › Networks (the endpoint is user-configurable)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/registry/remote.js',
    },
    {
        host: 'api.coingecko.com',
        party: 'third',
        why: 'USD price, market cap, 24h change and the 7-day chart for native coins',
        carries: 'the requesting IP, and that a wallet is in use; no addresses, no amounts',
        control: 'Settings › Privacy › coin statistics (ON by default; never requested on test networks)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/flows/priceOracle.js, packages/core/src/flows/priceLookup.js',
    },
    {
        host: 'ipfs.io',
        party: 'third',
        why: 'gateway for a token whose on-chain description points at ipfs://',
        carries: 'the requesting IP, and which token was opened',
        control: 'Settings › Privacy › token information (ON by default)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/flows/tokenInfo.js',
    },
    {
        host: 'arweave.net',
        party: 'third',
        why: 'gateway for a token whose on-chain description points at ar:',
        carries: 'the requesting IP, and which token was opened',
        control: 'Settings › Privacy › token information (ON by default)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/flows/tokenInfo.js',
    },
    {
        // The one entry with no fixed host, and the one that matters most on a
        // store form: the destination is chosen by whoever issued the token,
        // not by us and not by the user. It is registered as a CLASS because a
        // hostname list could never be complete.
        host: '*',
        party: 'third',
        why: 'a token information document (TIS) linked from the token\'s own on-chain description',
        carries: 'the requesting IP, and which token was opened, to a host the TOKEN ISSUER chose',
        control: 'Settings › Privacy › token information (ON by default)',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'packages/core/src/flows/tokenInfo.js (descriptionJsonUrl)',
    },
    {
        // WIRED 2026-08-02 (D4). This row used to say the Android feed
        // "has no caller yet" and list `desktop` alone; it now has exactly one
        // caller, and the LANE it runs on is the whole story for a store form.
        //
        // The request happens only on a directly-installed Android APK. It is
        // gated at runtime on the installer package (`XChainVault
        // .getInstallOrigin`), not on a build flag, because §6 derives the
        // universal APK from the same bundle as the store AAB - one build, two
        // signatures - so nothing at build time can tell the lanes apart. A
        // Play-installed copy of the SAME BYTES answers "store" and never
        // requests this. iOS cannot: its plugin does not implement the method,
        // and an in-app update notice there is an App Store rule violation.
        //
        // `mobile` is listed anyway, and deliberately over-discloses: the row
        // is true of the shell, the Play Data safety form is safer describing
        // a request the Play build does not make than omitting one it might,
        // and the lane restriction is stated here for whoever fills the form.
        host: 'downloads.xchain.io',
        party: 'first',
        why: 'update notice for installs no store keeps current (the desktop feed, and the direct Android APK)',
        carries: 'the requesting IP and the running version, at most once a day; no addresses, no identifiers',
        control: 'Settings › About › check for new versions (direct Android APK); Settings › Privacy (desktop). Never requested by a Play-installed or App Store build, on any setting',
        shells: ['desktop', 'mobile'],
        source: 'packages/web/src/update/directUpdateCheck.js, packages/web/src/update/directUpdateProvider.js',
    },
    // --- Egress on the EXTENSION only ---------------------------------------
    // The extension really does request these: it ships no
    // `content_security_policy` key, so MV3's default applies and the default
    // does not restrict img-src, and `History.jsx` renders each explorer's
    // favicon as a plain <img src>. Every other shell injects the §51 CSP,
    // whose `img-src 'self' data: blob:` has no remote origin in either build
    // profile, so the browser/WebView never makes the request at all.
    //
    // They stay on this list with the non-egressing shells omitted, so that
    // the next person reading the privacy policy beside the iOS labels can see
    // WHY one names five hosts the other does not.
    //
    // CORRECTED 2026-08-02 (S15). These five rows were written when
    // their `shells` was `[]`, and `carries`/`control` still described the
    // shells where the request does NOT happen: "nothing on this shell" and
    // "the CSP img-src admits no remote origin". Once `shells` became
    // `['extension']` those two fields said the opposite of the truth about
    // the one shell they claim, and about the single egress class the privacy
    // policy singles out as having no user control at all. Nothing caught it
    // because nothing read these two fields; the data-disclosure smoke does
    // now. When you edit `shells` on any row, re-read `carries` and `control`
    // in the same breath: they are per-shell statements living on a row that
    // does not repeat itself per shell.
    {
        host: 'mempool.space',
        party: 'third',
        why: 'the block-explorer icon beside a "view on explorer" link',
        carries: 'the requesting IP, and that a transaction detail view was opened',
        control: 'none: no toggle exists, and the request fires as the view renders, before the user clicks anything',
        shells: ['extension'],
        source: 'packages/core/src/shared/routes/History.jsx',
    },
    {
        host: 'blockstream.info',
        party: 'third',
        why: 'the block-explorer icon beside a "view on explorer" link',
        carries: 'the requesting IP, and that a transaction detail view was opened',
        control: 'none: no toggle exists, and the request fires as the view renders, before the user clicks anything',
        shells: ['extension'],
        source: 'packages/core/src/shared/routes/History.jsx',
    },
    {
        host: 'litecoinspace.org',
        party: 'third',
        why: 'the block-explorer icon beside a "view on explorer" link',
        carries: 'the requesting IP, and that a transaction detail view was opened',
        control: 'none: no toggle exists, and the request fires as the view renders, before the user clicks anything',
        shells: ['extension'],
        source: 'packages/core/src/shared/routes/History.jsx',
    },
    {
        host: 'blockchair.com',
        party: 'third',
        why: 'the block-explorer icon beside a "view on explorer" link',
        carries: 'the requesting IP, and that a transaction detail view was opened',
        control: 'none: no toggle exists, and the request fires as the view renders, before the user clicks anything',
        shells: ['extension'],
        source: 'packages/core/src/shared/routes/History.jsx',
    },
    {
        host: 'www.blockcypher.com',
        party: 'third',
        why: 'the block-explorer icon beside a "view on explorer" link',
        carries: 'the requesting IP, and that a transaction detail view was opened',
        control: 'none: no toggle exists, and the request fires as the view renders, before the user clicks anything',
        shells: ['extension'],
        source: 'packages/core/src/shared/routes/History.jsx',
    },
    {
        // Reachable only when the user pastes a restore link themselves, so it
        // is their contact rather than the app's; registered because a store
        // form asks about downloads and this is the honest answer to it.
        host: '*',
        party: 'third',
        why: 'restoring an encrypted wallet backup from a link the user supplies',
        carries: 'the requesting IP, to a host the user typed; the file is already encrypted with their password',
        control: 'user-initiated only; https links only',
        shells: ['web', 'desktop', 'extension', 'mobile'],
        source: 'restore-from-link flow',
    },
]);

/**
 * The hosts a given shell actually contacts, automatically, at default
 * settings. `*` entries are collapsed to the single wildcard, because that is
 * what a form answer has to disclose: "a host we do not choose".
 *
 * @param {string} shell
 * @returns {string[]} sorted, de-duplicated
 */
export function egressHostsFor(shell) {
    if (!SHELLS.includes(shell)) {
        throw new Error(`wireAudit: unknown shell ${JSON.stringify(shell)}; expected one of ${SHELLS.join(', ')}`);
    }
    const hosts = WIRE_AUDIT
        .filter((e) => e.shells.includes(shell))
        .map((e) => e.host);
    return [...new Set(hosts)].sort();
}

/**
 * Every hostname this audit knows about, egressing or not. The drift test
 * compares literals found in the egress modules against THIS set: a host that
 * is deliberately non-egressing is still registered, so adding a sixth block
 * explorer fails the test until someone classifies it.
 *
 * @returns {Set<string>}
 */
export function registeredHosts() {
    return new Set(WIRE_AUDIT.map((e) => e.host).filter((h) => h !== '*'));
}
