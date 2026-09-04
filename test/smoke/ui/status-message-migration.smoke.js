// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster K FOLLOWUP 1: the inline aria-live rows across
// `packages/core/src/shared/{routes,components}` migrate to the shared
// `<StatusMessage>` primitive, so a screen reader hears one grammar
// everywhere instead of 300 hand-rolled variations.
//
// The sweep is deliberately partial, and this smoke is where the CARVE-OUTS
// are written down, because a residual `role="alert"` is otherwise
// indistinguishable from one the sweep simply missed:
//
//   (a) warning-styled rows. `<StatusMessage>` ships status / error /
//       success and has no `warning`. Its `error` variant paints solid
//       `--xc-danger` with white text, so migrating an amber
//       `.warnings` container would silently promote every warning on the
//       send path into an error. Those keep their own markup until the
//       primitive grows a fourth variant.
//   (b) rows carrying `data-testid`. `<StatusMessage>` has no pass-through
//       for it, and the confirm-refusal / psbt-undecodable hooks are what
//       the fail-closed regression tests query.
//   (c) rows carrying inline `style`. Migrating drops the bespoke palette
//       rather than translating it; that is a per-row design call, not a
//       mechanical one.
//   (d) Toast / Banner / Overlay components, which the FOLLOWUP excludes by
//       name: they need bespoke role layouts.
//   (e) alert-role PANELS rather than message rows: block children (a
//       heading, several paragraphs, a button group). `<StatusMessage>`
//       wraps its children in a `<span>`, so a panel migrated through it
//       would put block content inside inline content.
//
// Static source-analysis smoke, matching error-recovery-sweep.smoke.js.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const shared = join(root, 'packages/core/src/shared');

function* walk(dir) {
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (name.endsWith('.jsx')) yield full;
    }
}

const files = [
    ...walk(join(shared, 'routes')),
    ...walk(join(shared, 'components')),
].map((f) => ({ path: relative(root, f), src: readFileSync(f, 'utf8') }));

// --- 1. the migration actually happened, at scale ---------------------

const adopters = files.filter((f) => /<StatusMessage[\s>]/.test(f.src));
assert.ok(
    adopters.length >= 90,
    `expected the sweep to reach 90+ shell files, saw ${adopters.length}`,
);

const elements = files.flatMap((f) =>
    [...f.src.matchAll(/<StatusMessage([^>]*)>/g)].map((m) => ({ file: f.path, attrs: m[1] })),
);
assert.ok(
    elements.length >= 240,
    `expected 240+ <StatusMessage> call sites across the shell, saw ${elements.length}`,
);

// --- 2. every adopter imports the primitive ---------------------------

for (const f of adopters) {
    assert.ok(
        /import \{[^}]*\bStatusMessage\b[^}]*\} from '(@xchain-wallet\/core\/ui|(?:\.\.\/)+ui\/index\.js)';/.test(f.src),
        `${f.path} renders <StatusMessage> but does not import it from the ui barrel`,
    );
    assert.ok(
        !/\bStatusMessage,\s*StatusMessage\b/.test(f.src),
        `${f.path} imports StatusMessage twice`,
    );
}

// --- 3. carve-out (a): no warning-styled row wears the error variant ---

for (const el of elements) {
    const cls = /className=\{styles\.([A-Za-z0-9_]+)\}/.exec(el.attrs);
    assert.ok(
        !cls || !/warn/i.test(cls[1]),
        `${el.file}: <StatusMessage> carries the warning-styled class \`${cls && cls[1]}\`; `
        + 'the primitive has no warning variant, so its error styling would recolour a warning as an error',
    );
}

// --- 4. carve-out (b): data-testid never rides on the primitive -------

for (const el of elements) {
    assert.ok(
        !/data-testid/.test(el.attrs),
        `${el.file}: <StatusMessage> carries a data-testid, which the primitive drops on the floor`,
    );
}

// --- 5. every residual role="alert" falls in a declared carve-out -----

// Walks the opening tag of each residual inline alert / aria-live row and
// checks it against the four reasons above. A row matching none of them is a
// genuine miss and fails here rather than sitting in the tree unnoticed.
const CARVED_FILE = /(Toast|Banner|Overlay)[A-Za-z]*\.jsx$/;
const BLOCK_CHILD = /<(div|p|ul|ol|table|li|section|pre|h[1-6])[\s/>]/;
const unexplained = [];

for (const f of files) {
    if (CARVED_FILE.test(f.path)) continue;
    const tagRe = /<(?:div|p|span)\s[^>]*?(?:role="alert"|aria-live=)[^>]*?>/gs;
    for (const m of f.src.matchAll(tagRe)) {
        const tag = m[0];
        // A `role="status"` / `aria-live` container (spinner, banner, panel)
        // is not a message row; the FOLLOWUP leaves those alone too.
        if (!/role="alert"/.test(tag)) continue;
        if (/style=/.test(tag)) continue;                                    // (c)
        if (/data-testid/.test(tag)) continue;                               // (b)
        const cls = /className=\{styles\.([A-Za-z0-9_]+)\}/.exec(tag);
        if (cls && /warn/i.test(cls[1])) continue;                           // (a)
        // (e): peek at the body. A row whose children are block elements is a
        // panel, not a message, and the primitive would nest it inside a span.
        const body = f.src.slice(m.index + tag.length, m.index + tag.length + 400);
        if (BLOCK_CHILD.test(body)) continue;
        unexplained.push(`${f.path}: ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
}

assert.deepEqual(
    unexplained,
    [],
    `inline role="alert" rows left in the shell with no declared carve-out:\n  ${unexplained.join('\n  ')}`,
);

// --- 6. named call sites, so a wholesale revert cannot pass -----------

const named = {
    'packages/core/src/shared/components/TokenField.jsx': /<StatusMessage variant="error" id=\{errorId\} className=\{styles\.error\}>\{error\}<\/StatusMessage>/,
    'packages/core/src/shared/routes/ResumeConfirm.jsx': /<StatusMessage variant="error">\{error\}<\/StatusMessage>/,
    'packages/core/src/shared/routes/Send.jsx': /<StatusMessage variant="error" className=\{styles\.error\}>\{loadError\}<\/StatusMessage>/,
};
for (const [path, re] of Object.entries(named)) {
    const f = files.find((x) => x.path === path);
    assert.ok(f, `${path} not found`);
    assert.match(f.src, re, `${path} lost its migrated StatusMessage row`);
}

// --- 7. the carve-outs are still real, not stale -----------------------

// Send.jsx is the canonical warning-styled surface: if `.warnings` ever stops
// being amber-on-amber the (a) carve-out should be revisited, not inherited.
const sendCss = readFileSync(join(shared, 'routes/Send.module.css'), 'utf8');
assert.match(
    sendCss,
    /\.warnings \{[^}]*--xc-warning/s,
    'Send.module.css.warnings no longer keys off --xc-warning; revisit carve-out (a)',
);

// StatusMessage still ships exactly three variants, which is why (a) exists.
const primitive = readFileSync(join(root, 'packages/core/src/ui/StatusMessage.jsx'), 'utf8');
assert.match(
    primitive,
    /'status' \| 'error' \| 'success'/,
    'StatusMessage variant set changed; re-run the sweep against the new variants',
);
assert.ok(
    !/data-testid/.test(primitive),
    'StatusMessage grew a data-testid pass-through; carve-out (b) can now be swept',
);

// The banner owns its colours. Callers pass `className` for layout, and ten
// route modules name that class `.error` with `color: var(--xc-danger)`; at
// equal specificity the later rule in the bundle won, and on the Add
// addresses page that painted danger-red text on the danger-red banner (a
// public tester saw "a blank red bar", 2026-09-02). Compound selectors keep
// the variant colours above any single-class caller override.
const primitiveCss = readFileSync(join(root, 'packages/core/src/ui/StatusMessage.module.css'), 'utf8');
for (const variant of ['status', 'error', 'success']) {
    assert.match(
        primitiveCss,
        new RegExp(`^\\.row\\.${variant} \\{`, 'm'),
        `StatusMessage.module.css paints the ${variant} variant through the compound .row.${variant} selector`,
    );
    assert.ok(
        !new RegExp(`^\\.${variant} \\{`, 'm').test(primitiveCss),
        `StatusMessage.module.css still carries a bare .${variant} rule that a caller's single class can override`,
    );
}
assert.match(
    primitiveCss,
    /^\.row\.error \{[^}]*background: var\(--xc-danger\);[^}]*color: var\(--xc-on-danger\);/m,
    'the error variant paints on-danger text over the danger background',
);

console.log(
    `OK: StatusMessage migration (Cluster K FOLLOWUP 1: ${elements.length} <StatusMessage> rows`
    + `across ${adopters.length} shell files; every residual role="alert" matches a declared carve-out)`,
);
