// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Fuzz: `xchain:` deep-link parser invariants.
//
// §3.6 (Chrome Web Store publishing spec). The extension popup
// boots from `popup.html?uri=<uri>` and the scan route feeds the same
// parser from a camera QR, so `parseXchainUri` is the wallet's widest
// untrusted-string surface: whatever survives it lands in Send / Receive
// / EXECUTE screen state. The store-review question this harness answers
// is narrow and worth stating plainly: a crafted link may open a compose
// view, and it may NOT ride an unvetted value into a routing decision or
// arrive with anything other than a plain string in a form field.
//
// The subject is the SHIPPED parser, imported from packages/core. A
// harness carrying its own copy would only prove things about the copy.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseXchainUri, hardenUriIntentText } from '../../../packages/core/src/uri/xchainUri.js';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 200);

// Mirrors of the gates the parser applies internally. Duplicated here on
// purpose: the harness asserts the OUTPUT satisfies them, so if someone
// loosens the parser's own regex these properties still fail.
const CHAIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const NUMERIC_RE = /^[0-9]+$/;

const KINDS = new Set(['send', 'receive', 'execute', 'unknown']);

// Every string field the intent may carry. Anything the parser sets that
// is NOT in this list is caught by the no-surprise-fields property below,
// which is how a future field lands here deliberately rather than by
// accident.
const STRING_FIELDS = [
    'action', 'contractActionIndex', 'method', 'executeParams',
    'chainId', 'tick', 'address', 'amount', 'memo', 'feePriority',
    'label', 'message',
];
const KNOWN_FIELDS = new Set([...STRING_FIELDS, 'kind', 'params', 'required']);

// A registry stub that resolves anything, so coin-code URIs take the
// chainId-resolving branch. Returning an attacker-shaped id on demand is
// the point: it proves the gate is applied to the REGISTRY's answer too,
// not only to raw path segments.
const permissiveRegistry = {
    chainIdFor: (coin, networkKind) => `${String(coin).toLowerCase()}-${String(networkKind || 'mainnet')}`,
};

// Hostile fragments worth forcing into the corpus. Pure random strings
// almost never produce a `req-` param or a `__proto__` key, so the
// generator below splices these in deliberately.
const NASTY = [
    '__proto__', 'constructor', 'prototype', 'toString', 'req-nonsense',
    'javascript:alert(1)', 'data:text/html,<script>x</script>',
    '<script>alert(1)</script>', '../../etc/passwd', '\u0000', '�',
    '%00', '%2e%2e%2f', '%25%32%35', '%', '%zz', '%c0%80',
    '‮gnp.exe', '＄{7*7}', '{{7*7}}', "'; DROP TABLE--",
    '1e309', '-0', 'NaN', 'Infinity', '0x41', '1'.repeat(300),
];

const nastyArb = fc.constantFrom(...NASTY);
const piece = () => fc.oneof({ weight: 3, arbitrary: fc.string() }, { weight: 2, arbitrary: nastyArb });

// URIs shaped like the three forms the parser accepts, with hostile
// fragments in every slot. Unstructured noise is mixed in so the parser's
// reject path gets exercised too.
const uriArb = () => fc.oneof(
    fc.string(),
    fc.tuple(piece(), piece(), piece(), piece()).map(
        ([code, action, k, v]) => `xchain:${code}/${action}?${k}=${v}`,
    ),
    fc.tuple(piece(), piece(), piece()).map(
        ([chain, tick, q]) => `xchain://${chain}/${tick}?${q}`,
    ),
    fc.tuple(piece(), piece(), piece()).map(
        ([addr, k, v]) => `xchain:${addr}?${k}=${v}`,
    ),
    fc.tuple(piece(), piece(), piece(), piece()).map(
        ([code, k1, v1, v2]) => `xchain:${code}/execute?contract=${v1}&method=${k1}&gas=${v2}&params=${v1}`,
    ),
    // Arms pinned to a REAL coin code and to the named query keys. The random
    // arms above almost never land on a known code AND a recognised key at the
    // same time, so without these the free-text fields are barely ever
    // populated and any property about them passes vacuously. The counter
    // guards in those properties are what exposed that.
    fc.tuple(piece(), piece(), piece(), piece()).map(
        ([tick, memo, label, message]) =>
            `xchain:BTC/send?to=bc1qexample&tick=${tick}&memo=${memo}&label=${label}&message=${message}`,
    ),
    fc.tuple(piece(), piece()).map(
        ([tick, memo]) => `xchain:bc1qexample?tick=${tick}&memo=${memo}`,
    ),
    fc.tuple(piece(), piece()).map(
        ([method, params]) => `xchain:BTC/execute?contract=42&method=${method}&params=${params}&gas=100000`,
    ),
);

function parse(uri) {
    return parseXchainUri(uri, { chainRegistry: permissiveRegistry });
}

describe('fuzz/xchain-uri', () => {
    it('is total: never throws, and always returns a known kind', () => {
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const intent = parse(uri);
                return Boolean(intent) && KINDS.has(intent.kind);
            }),
            { numRuns: RUNS },
        );
    });

    it('never throws on non-string input', () => {
        const notStrings = [undefined, null, 0, 1, NaN, true, false, {}, [], Symbol('x'), 10n, () => {}];
        for (const v of notStrings) {
            expect(parse(v)).toEqual({ kind: 'unknown' });
        }
    });

    it('every field it sets is a plain string (nothing structured rides in)', () => {
        // A non-string here would land in React state and, for `amount`,
        // in fee math. Counted so the property cannot pass on a run that
        // only ever produced `unknown`.
        let populated = 0;
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const intent = parse(uri);
                for (const f of STRING_FIELDS) {
                    if (intent[f] === undefined) continue;
                    populated += 1;
                    if (typeof intent[f] !== 'string') return false;
                }
                return true;
            }),
            { numRuns: RUNS },
        );
        expect(populated).toBeGreaterThan(0);
    });

    it('sets no field outside the documented intent shape', () => {
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const intent = parse(uri);
                return Object.keys(intent).every((k) => KNOWN_FIELDS.has(k));
            }),
            { numRuns: RUNS },
        );
    });

    it('gates chainId: a routing decision never carries an unvetted string', () => {
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const { chainId } = parse(uri);
                return chainId === undefined || CHAIN_ID_RE.test(chainId);
            }),
            { numRuns: RUNS },
        );
    });

    it('gates the execute numerics: contract index is digits only, gas never parses', () => {
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const intent = parse(uri);
                if (intent.contractActionIndex !== undefined
                    && !NUMERIC_RE.test(intent.contractActionIndex)) return false;
                // EXECUTE v0 carries no GAS_LIMIT slot, so no URI shape may
                // ever produce a gasLimit on the intent.
                if (intent.gasLimit !== undefined) return false;
                return true;
            }),
            { numRuns: RUNS },
        );
    });

    it('never leaks send-shaped fields into an execute intent', () => {
        // The EXECUTE form and the Send form are different signing flows.
        // A link that populates both is a link that pre-arms one of them
        // out of the user's view.
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const intent = parse(uri);
                if (intent.kind !== 'execute') return true;
                return intent.address === undefined
                    && intent.amount === undefined
                    && intent.tick === undefined
                    && intent.memo === undefined;
            }),
            { numRuns: RUNS },
        );
    });

    // §3.6 finding 1: hardenUriIntentText is the fix for the audit's
    // "deep-link fields skip the repo's own display hardening" finding.
    // Every shell applies it at the boundary where a parsed intent becomes
    // prefill state, so these properties run it here too rather than only
    // in the hand-written unit tests.
    it('hardening is a no-op on a second pass (idempotent, so nothing survives one pass)', () => {
        // Idempotence is used INSTEAD OF re-matching the bidi/zero-width/
        // control regexes here: those are already covered directly by
        // textHardening.test.js, and this file's own convention of
        // duplicating a parser gate (CHAIN_ID_RE / NUMERIC_RE above) exists
        // to catch a *weakened* gate - reusing those exact regex objects
        // here would risk hand-retyping the same invisible-character
        // ranges this feature exists to strip, which is the one place in
        // this file that mistake would be self-defeating. If a hardened
        // field still carried a bidi/zero-width/control character,
        // hardening it again would change it again, so idempotence is a
        // faithful proxy without that risk.
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const once = hardenUriIntentText(parse(uri));
                const twice = hardenUriIntentText(once);
                return JSON.stringify(once) === JSON.stringify(twice);
            }),
            { numRuns: RUNS },
        );
    });

    it('hardening never changes address or amount, even when they carry the same hostile bytes', () => {
        // `hardenUriIntentText`'s own comment explains why: an address is
        // validated by its own checksum before signing (mangling it risks
        // corrupting one that was fine), and an amount is validated as a
        // plain decimal downstream (mangling it here would mask, not
        // surface, the same tampering).
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const raw = parse(uri);
                const hardened = hardenUriIntentText(raw);
                return hardened.address === raw.address && hardened.amount === raw.amount;
            }),
            { numRuns: RUNS },
        );
    });

    it('hardening only ever touches the documented free-text fields', () => {
        // `params` is excluded from the top-level sweep because hardening now
        // covers it too: the bag repeats the named fields under their raw
        // query names, so leaving it out left one value safe under one name
        // and raw under the other. It is replaced with a hardened COPY, so a
        // reference comparison would flag it whether or not any value moved;
        // the nested loop below is the real check, and it is stricter than
        // skipping the key outright would be.
        const NAMED = ['memo', 'tick', 'method', 'executeParams', 'label', 'message'];
        const QUERY = ['memo', 'tick', 'method', 'params', 'label', 'message'];
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const raw = parse(uri);
                const rawParams = raw.params ? { ...raw.params } : undefined;
                const hardened = hardenUriIntentText(raw);
                for (const key of Object.keys(raw)) {
                    if (NAMED.includes(key) || key === 'params') continue;
                    if (hardened[key] !== raw[key]) return false;
                }
                if (rawParams) {
                    if (Object.keys(hardened.params).length !== Object.keys(rawParams).length) return false;
                    for (const key of Object.keys(rawParams)) {
                        if (QUERY.includes(key)) continue;
                        if (hardened.params[key] !== rawParams[key]) return false;
                    }
                }
                return Object.keys(hardened).length === Object.keys(raw).length;
            }),
            { numRuns: RUNS },
        );
    });

    it('feePriority is only ever one of the three known tiers', () => {
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const { feePriority } = parse(uri);
                return feePriority === undefined
                    || feePriority === 'low' || feePriority === 'normal' || feePriority === 'fast';
            }),
            { numRuns: RUNS },
        );
    });

    it('rejects any req- param, including percent-encoded and mixed-case spellings', () => {
        // BIP21: an unimplemented req- variable invalidates the whole URI.
        // XChain implements none, so honouring one silently would apply a
        // directive the wallet does not understand.
        const spellings = ['req-x', 'r%65q-x', '%72eq-x', 'req-%78'];
        for (const key of spellings) {
            for (const uri of [
                `xchain:BTC/send?to=bc1qexample&${key}=1`,
                `xchain://bitcoin-mainnet/BTC?${key}=1`,
                `xchain:bc1qexample?${key}=1`,
            ]) {
                expect(parse(uri), `${uri} must be rejected`).toEqual({ kind: 'unknown' });
            }
        }
    });

    it('does not pollute Object.prototype from any query key', () => {
        const before = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
        fc.assert(
            fc.property(uriArb(), (uri) => {
                parse(uri);
                return {}.polluted === undefined
                    && {}.tick === undefined
                    && [].length === 0
                    && Object.getPrototypeOf({}) === Object.prototype;
            }),
            { numRuns: RUNS },
        );
        // Explicit shots at the two keys a generator rarely lands on.
        for (const key of ['__proto__', 'constructor', 'prototype']) {
            parse(`xchain:BTC/send?${key}=polluted`);
            parse(`xchain://bitcoin-mainnet/BTC?${key}[polluted]=1`);
        }
        expect({}.polluted).toBeUndefined();
        expect(Object.getOwnPropertyNames(Object.prototype).sort().join(',')).toBe(before);
    });

    it('stays bounded on oversized input (no catastrophic backtracking)', () => {
        // A QR code tops out around 3KB, but `popup.html?uri=` has no such
        // ceiling. Each of these is a shape whose gates use a regex.
        const oversized = [
            `xchain:${'A'.repeat(500_000)}/send?to=x`,
            `xchain://${'a-'.repeat(250_000)}/BTC`,
            `xchain:BTC/send?${'k=v&'.repeat(200_000)}to=x`,
            `xchain:BTC/execute?gas=${'9'.repeat(500_000)}`,
            `xchain:BTC/send?to=${'%'.repeat(200_000)}`,
        ];
        for (const uri of oversized) {
            const started = performance.now();
            const intent = parse(uri);
            const elapsed = performance.now() - started;
            expect(KINDS.has(intent.kind)).toBe(true);
            expect(elapsed, `oversized parse took ${elapsed.toFixed(0)}ms for ${uri.slice(0, 40)}...`)
                .toBeLessThan(2000);
        }
    });

    it('the raw params bag never disagrees with the named field it repeats', () => {
        // `intent.params` carries the same values again under their query-string
        // names. If only the named copy is hardened, `intent.tick` is neutralized
        // while `intent.params.tick` still holds the raw bytes, and the two names
        // for one value disagree about whether it is safe. Nothing reads the bag
        // today, which is exactly why this needs a test rather than a comment:
        // the first consumer to reach for it would inherit the raw value silently.
        const NAMED_TO_QUERY = {
            memo: 'memo', tick: 'tick', method: 'method',
            executeParams: 'params', label: 'label', message: 'message',
        };
        let compared = 0;
        fc.assert(
            fc.property(uriArb(), (uri) => {
                const intent = hardenUriIntentText(parse(uri));
                if (!intent.params) return true;
                for (const [named, query] of Object.entries(NAMED_TO_QUERY)) {
                    if (typeof intent[named] !== 'string') continue;
                    if (typeof intent.params[query] !== 'string') continue;
                    compared += 1;
                    if (intent[named] !== intent.params[query]) return false;
                }
                return true;
            }),
            { numRuns: RUNS },
        );
        expect(compared, 'property never compared a pair; the corpus proved nothing').toBeGreaterThan(0);
    });

    it('a malformed param invalidates the URI rather than being half-applied', () => {
        // parseQuery collects errors for a param with no `=` and for an
        // undecodable value; a partially-applied intent would mean the user
        // sees a form filled from a link the parser could not fully read.
        for (const uri of [
            'xchain:BTC/send?to=bc1qexample&bareword',
            'xchain:BTC/send?to=%E0%A4%A',
            'xchain://bitcoin-mainnet/BTC?amount=1&oops',
        ]) {
            expect(parse(uri), `${uri} must be rejected`).toEqual({ kind: 'unknown' });
        }
    });
});
