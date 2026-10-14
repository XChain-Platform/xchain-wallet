// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Content-Security-Policy for the web SPA shell (§9.5 / §51).
//
// The wallet caches sensitive material in the page (the session password
// cache, in-page wallet host); its only structural defense against an XSS
// payload exfiltrating that material is a CSP that forbids inline/injected
// script and outbound posts to attacker-controlled origins. Previously the
// SPA shipped none and relied entirely on a server-sent header, which ops
// can forget and which never applies when the bundle is opened from disk
// or served by a misconfigured host. This policy is injected into the
// built index.html (see vite.config.js) so it travels with the app.
//
// Notes on specific directives:
//   - script-src 'self' + the configured Trezor Connect origin: bundled ES modules,
//     plus Trezor's hosted Connect global build which we load at runtime
//     instead of bundling the T-RSL-licensed @trezor/connect-web npm
//     package (see signers/trezorFactory.js). No 'unsafe-inline' and no
//     'unsafe-eval'; the crypto stack (@noble/hashes argon2id) is pure
//     JS, so no wasm-unsafe-eval is required.
//   - frame-src 'self' + the configured Trezor Connect origin: Trezor Connect runs
//     its signing UI in a cross-origin iframe/popup it hosts. Without this
//     the directive would fall back to default-src 'self' and block it.
//   - style-src 'unsafe-inline': the UI uses React inline style attributes
//     (style={{...}}) and runtime-injected <style> tags extensively. Inline
//     styles cannot exfiltrate data, so this is a low-risk allowance.
//   - connect-src names the fixed egress hosts from the wire-audit registry
//     and the local ports from the chain descriptors. A script injection
//     therefore cannot post wallet material to an arbitrary HTTPS endpoint.
//   - frame-ancestors is part of the policy but is header-only by spec:
//     a <meta> CSP ignores it (with a console warning), so the meta tag
//     omits it and the fronting server (Apache) sends it as a header to
//     actually prevent framing.
//   - img/font allow data: + blob: for QR codes and the favicon.

import { WIRE_AUDIT } from '../../core/src/privacy/wireAudit.js';
import { bitcoinDescriptors } from '../../core/src/registry/descriptors/bitcoin.js';
import { dogecoinDescriptors } from '../../core/src/registry/descriptors/dogecoin.js';
import { litecoinDescriptors } from '../../core/src/registry/descriptors/litecoin.js';
import {
    DEFAULT_MINER_URL,
    TREZOR_CONNECT_ORIGIN,
} from '../../core/src/branding/branding.js';

// PROFILES (; rails §3 owns the names). The policy is not the
// same on every shell, because the shells do not have the same capabilities.
// `store` is the mobile build: there is no WebHID in a WKWebView or an Android
// WebView, so the hardware-signer path is unreachable there BY DESIGN, and the
// Trezor origins below would be a permanently-allowed third-party script origin
// for a feature the build cannot have. In a wallet whose main structural
// defence against an XSS payload is exactly this directive, an unusable
// allowance is not neutral: it is a remote-code surface kept open for nothing,
// and one more thing to explain to an app-store reviewer.
export const BUILD_PROFILES = Object.freeze(['default', 'store']);
export const DEFAULT_BUILD_PROFILE = 'default';

const CHAIN_DESCRIPTORS = [
    ...bitcoinDescriptors,
    ...dogecoinDescriptors,
    ...litecoinDescriptors,
];

function endpointOrigin(endpoint) {
    const url = new URL(endpoint.defaultUrl);
    if (![80, 443].includes(endpoint.defaultPort)) url.port = String(endpoint.defaultPort);
    return url.origin;
}

function fixedEgressOrigins() {
    return WIRE_AUDIT
        .filter((entry) => (
            entry.host !== '*'
            && entry.shells.some((shell) => shell === 'web' || shell === 'mobile')
        ))
        .map((entry) => `https://${entry.host}`);
}

function configuredEndpointOrigins() {
    return CHAIN_DESCRIPTORS.flatMap((descriptor) => (
        ['explorer', 'encoder', 'hub'].map((name) => endpointOrigin(descriptor[name]))
    ));
}

function configuredExplorerSocketOrigins() {
    return CHAIN_DESCRIPTORS.map((descriptor) => {
        const origin = new URL(endpointOrigin(descriptor.explorer));
        origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
        return origin.origin;
    });
}

function connectSources() {
    return [
        "'self'",
        ...new Set([
            ...fixedEgressOrigins(),
            ...configuredEndpointOrigins(),
            // Developer Mode exposes this fixed regtest-miner default beside
            // the descriptor-backed explorer, encoder, and hub endpoints.
            DEFAULT_MINER_URL,
            ...configuredExplorerSocketOrigins(),
        ]),
    ];
}

/** @type {Record<string, string[]>} */
const DIRECTIVES = {
    'default-src': ["'self'"],
    // Both Trezor entries name the constant, never a literal: the `store` filter
    // in directivesFor drops the origin by identity, so a literal edited here
    // alone would stop matching and keep the origin in the store build.
    'script-src': ["'self'", TREZOR_CONNECT_ORIGIN],
    'style-src': ["'self'", "'unsafe-inline'"],
    'frame-src': ["'self'", TREZOR_CONNECT_ORIGIN],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
};

/**
 * The directive set for a build profile.
 *
 * Subtractive on purpose: `store` is `default` minus what it cannot use, so a
 * directive added for every shell is added once and a profile can only ever
 * hold LESS than the full policy. A profile that could add origins would be a
 * way to widen the wallet's main XSS defence in a build nobody reviews as
 * closely as the web one.
 *
 * @param {string} [profile]
 * @returns {Record<string, string[]>}
 */
export function directivesFor(profile = DEFAULT_BUILD_PROFILE) {
    if (!BUILD_PROFILES.includes(profile)) {
        throw new Error(
            `csp: unknown build profile ${JSON.stringify(profile)};`
            + ` expected one of ${BUILD_PROFILES.join(', ')}`,
        );
    }
    const directives = Object.fromEntries(
        Object.entries(DIRECTIVES).map(([name, values]) => [name, [...values]]),
    );
    directives['connect-src'] = connectSources();
    if (profile === 'store') {
        for (const name of ['script-src', 'frame-src']) {
            directives[name] = directives[name].filter((v) => v !== TREZOR_CONNECT_ORIGIN);
        }
    }
    return directives;
}

/**
 * The Content-Security-Policy value as a single header/meta string.
 * @param {string} [profile]
 */
export function contentSecurityPolicyFor(profile = DEFAULT_BUILD_PROFILE) {
    return Object.entries(directivesFor(profile))
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ');
}

// Directives the CSP spec defines as header-only. A <meta> CSP never
// enforces these; every supporting browser instead prints a console
// warning per document (and again per extension content-script world),
// so carrying them in the meta tag buys no protection and costs noise.
// They stay in the header policy above, which the fronting server must
// send for them to bite (wallet.xchain.io's Apache vhost does).
const HEADER_ONLY_DIRECTIVES = ['frame-ancestors'];

/**
 * The policy string for a <meta http-equiv> tag: the full policy minus
 * the header-only directives a meta CSP cannot express.
 * @param {string} [profile]
 */
export function metaContentSecurityPolicyFor(profile = DEFAULT_BUILD_PROFILE) {
    return Object.entries(directivesFor(profile))
        .filter(([name]) => !HEADER_ONLY_DIRECTIVES.includes(name))
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ');
}

/** The default profile's policy. Kept as a constant: most callers are web. */
export const CONTENT_SECURITY_POLICY = contentSecurityPolicyFor(DEFAULT_BUILD_PROFILE);

/**
 * The full `<meta http-equiv="Content-Security-Policy">` tag.
 * @param {string} [profile]
 */
export function cspMetaTag(profile = DEFAULT_BUILD_PROFILE) {
    return `<meta http-equiv="Content-Security-Policy" content="${metaContentSecurityPolicyFor(profile)}" />`;
}

/**
 * Allow one inline script, identified by its digest, in a policy string's
 * script-src. Used for the generated import map, the only inline script the
 * page carries; a hash admits exactly those bytes and nothing else.
 *
 * @param {string} policy a policy string from contentSecurityPolicyFor / metaContentSecurityPolicyFor
 * @param {string} hash   a CSP hash source body, e.g. "sha384-AbC..."
 * @returns {string}
 */
export function allowInlineScriptHash(policy, hash) {
    const source = `'${hash}'`;
    return policy
        .split('; ')
        .map((d) => (d.startsWith('script-src ') && !d.split(' ').includes(source) ? `${d} ${source}` : d))
        .join('; ');
}
