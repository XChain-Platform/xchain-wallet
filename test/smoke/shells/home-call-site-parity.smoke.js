// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WHAT EACH SHELL HANDS <Home>, CHECKED AGAINST WHAT Home TAKES.
//
// test/unit/routes/Home.deadProps.test.jsx guards one direction: Home declares
// no prop it never reads. This check covers the shell side of the contract.
//
// Home receives no destination handlers owned by the shared wallet menu and
// navigation surfaces: onMyTokens, onMarketActivity, onCrossChain, onContacts
// and onMultisig. Its explicit parameter list has no rest spread.
//
// Every shell supplies `onSelectEntry`. Home forwards it to HomeTabs, which
// gives every demo Activity and DeFi row an effective onClick handler.
//
// WHY IT IS A SOURCE READ. Rendering Home in three shells needs a wallet,
// a vault and a host per shell. The question here is narrower and answers
// itself off the text: which names cross the boundary, compared against
// the names on the other side of it.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...parts) => readFileSync(join(wsRoot, ...parts), 'utf8');

const homeSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');

const SHELLS = [
    ['web', ['packages', 'web', 'src', 'App.jsx']],
    ['extension', ['packages', 'extension', 'src', 'popup', 'App.jsx']],
    ['desktop', ['packages', 'desktop', 'renderer', 'App.jsx']],
];

/**
 * Prop names bound by `export function Home({ ... })`, with `a: b` renames
 * resolved to the OUTER name (what a call site must spell) and defaults
 * stripped.
 *
 * @param {string} src Home.jsx source.
 * @returns {Set<string>}
 */
function homeAccepts(src) {
    const sig = src.match(/export function Home\(\{([\s\S]*?)\}\)\s*\{/);
    assert.ok(sig, 'Home.jsx still declares `export function Home({ ... })`');
    assert.ok(
        !/\.\.\./.test(sig[1]),
        'Home takes no rest-spread, so an unlisted prop is unreachable rather '
        + 'than forwarded. If that changes, this smoke needs to change with it.',
    );
    const names = sig[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => (part.includes(':') ? part.split(':')[0] : part.split('=')[0]).trim());
    return new Set(names);
}

/**
 * Attribute names on a shell's `<Home ... />` element.
 *
 * Anchored on `<Home` followed by a newline, which is the element; the
 * `<Home>` that appears inside desktop's prose comments is not. Attribute
 * lines are `name={...}` or a bare boolean `name`; continuation lines
 * inside a multi-line arrow body are statements or closers and match
 * neither, because an identifier there is followed by `(`, `.`, `:` or `,`.
 *
 * @param {string} src   Shell App.jsx source.
 * @param {string} shell Shell name, for the assertion message.
 * @returns {string[]}
 */
function homeCallSiteProps(src, shell) {
    const el = src.match(/\n[ \t]*<Home\n([\s\S]*?)\n[ \t]*\/>/);
    assert.ok(el, `${shell} App.jsx mounts a <Home ... /> element`);
    const props = el[1]
        .split('\n')
        .map((line) => line.match(/^[ \t]{4,}([A-Za-z_$][\w$]*)(?:=|[ \t]*$)/))
        .filter(Boolean)
        .map((m) => m[1]);
    // Vacuity guard: a regex that silently stops matching would make every
    // assertion below pass over an empty list. Every shell passes at least
    // the wallet id and the core navigation handlers.
    assert.ok(
        props.length >= 20,
        `${shell}: parsed only ${props.length} <Home> props. The call site changed `
        + 'shape; fix this parser rather than letting the comparison pass vacuously.',
    );
    for (const required of ['activeWalletId', 'onSend', 'onReceive', 'onHistory']) {
        assert.ok(
            props.includes(required),
            `${shell}: parser lost the known-present '${required}' prop`,
        );
    }
    return props;
}

// --- 1. No shell hands Home a prop Home cannot read ---------------------

const accepted = homeAccepts(homeSrc);
assert.ok(accepted.size > 20, 'parsed a real Home signature, not an empty match');

for (const [shell, path] of SHELLS) {
    const props = homeCallSiteProps(read(...path), shell);
    const inert = [...new Set(props)].filter((p) => !accepted.has(p));
    assert.deepEqual(
        inert,
        [],
        `${shell} App.jsx passes ${inert.length} prop(s) <Home> does not accept: `
        + `${inert.join(', ')}. Home has no rest-spread, so these reach no render `
        + 'path. Either drop them or route them through a surface this shell '
        + 'actually mounts (its Actions menu, LeftNav or the command palette).',
    );
}

// --- 2. Every shell arms onSelectEntry and owns action-detail -----------

// Home forwards onSelectEntry to HomeTabs, whose demo Activity and DeFi
// rows are unconditional <button>s. A shell that omits it ships rows that
// look pressable and do nothing, so arming it and owning the destination
// route are one contract, not two.
assert.match(
    homeSrc,
    /onSelectEntry=\{onSelectEntry\}/,
    'Home still forwards onSelectEntry to HomeTabs',
);
const homeTabsSrc = read(
    'packages', 'core', 'src', 'shared', 'components', 'HomeTabs.jsx',
);
assert.ok(
    (homeTabsSrc.match(/onSelectEntry/g) || []).length >= 3,
    'HomeTabs still routes demo rows through onSelectEntry',
);

for (const [shell, path] of SHELLS) {
    const src = read(...path);
    assert.ok(
        homeCallSiteProps(src, shell).includes('onSelectEntry'),
        `${shell} App.jsx arms onSelectEntry on <Home>; without it the demo `
        + 'Activity and DeFi rows are live buttons with no effect',
    );
    assert.match(
        src,
        /unlockedView === 'action-detail'/,
        `${shell} App.jsx routes unlockedView 'action-detail'`,
    );
    assert.match(
        src,
        /<ActionDetail\b/,
        `${shell} App.jsx mounts <ActionDetail> as that route's destination`,
    );
}

console.log(
    `OK: Home call-site parity (${accepted.size} accepted props; 3 shells pass `
    + 'no inert prop and all three arm onSelectEntry with an action-detail route)',
);
