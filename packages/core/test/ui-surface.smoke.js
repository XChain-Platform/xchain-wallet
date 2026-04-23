// Smoke test for packages/core/src/ui/.
//
// Run with `node packages/core/test/ui-surface.smoke.js` from the repo root.
//
// The ui layer is React/JSX and its real runtime smoke lives inside a shell
// bundle (popup piece, Batch 2). This smoke runs in pure Node and verifies:
//   - tokens.css exists and declares the expected custom properties + the
//     dark / reduced-motion media blocks.
//   - Each primitive ships with a named export and a co-located CSS module.
//   - `ui/index.js` re-exports every primitive.
//   - `core/package.json` declares the `./ui` and `./ui/tokens.css` subpath
//     exports so shells can import them without deep path reaches.
//   - React + `@vitejs/plugin-react` are declared where consumed.

import { strict as assert } from 'node:assert';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const uiDir = join(pkgRoot, 'src', 'ui');
const wsRoot = join(pkgRoot, '..', '..');

// --- tokens.css ---------------------------------------------------------
const tokens = readFileSync(join(uiDir, 'tokens.css'), 'utf8');
for (const token of [
    '--xc-space-4',
    '--xc-accent-primary',
    '--xc-accent-secondary',
    '--xc-font-sans',
    '--xc-font-mono',
    '--xc-bg',
    '--xc-text',
    '--xc-danger',
    '--xc-focus-ring',
    '--xc-transition',
    '--xc-radius-md',
]) {
    assert.ok(tokens.includes(token), `tokens.css defines ${token}`);
}
assert.ok(
    tokens.includes('@media (prefers-color-scheme: dark)'),
    'tokens.css has dark-mode block',
);
assert.ok(
    tokens.includes('@media (prefers-reduced-motion: reduce)'),
    'tokens.css has reduced-motion block',
);
assert.ok(
    tokens.includes('#1E90C7'),
    'tokens.css accent-primary matches branding.js ACCENT_PRIMARY',
);
assert.ok(
    tokens.includes('#7B2C8F'),
    'tokens.css accent-secondary matches branding.js ACCENT_SECONDARY',
);

// --- primitives + co-located CSS modules --------------------------------
const components = [
    ['Screen.jsx', 'Screen'],
    ['Button.jsx', 'Button'],
    ['Input.jsx', 'Input'],
    ['ChainBadge.jsx', 'ChainBadge'],
    ['AddressText.jsx', 'AddressText'],
    ['CopyButton.jsx', 'CopyButton'],
];

for (const [file, name] of components) {
    const src = readFileSync(join(uiDir, file), 'utf8');
    const exportRe = new RegExp(
        `export\\s+(?:const|function)\\s+${name}\\b`,
        'm',
    );
    assert.ok(exportRe.test(src), `${file} exports ${name}`);
    assert.ok(
        src.includes(`from './${file.replace('.jsx', '.module.css')}'`),
        `${file} imports its CSS module`,
    );
    const cssPath = join(uiDir, file.replace('.jsx', '.module.css'));
    statSync(cssPath);
    const css = readFileSync(cssPath, 'utf8');
    assert.ok(css.length > 0, `${cssPath} is non-empty`);
    assert.ok(css.includes('var(--xc-'), `${cssPath} references design tokens`);
}

// --- ui/index.js re-exports --------------------------------------------
const uiIndex = readFileSync(join(uiDir, 'index.js'), 'utf8');
for (const [, name] of components) {
    assert.ok(
        new RegExp(`export\\s+\\{\\s*${name}\\b`).test(uiIndex),
        `ui/index.js re-exports ${name}`,
    );
}

// --- package.json exports map + dependency wiring ----------------------
const corePkg = JSON.parse(
    readFileSync(join(pkgRoot, 'package.json'), 'utf8'),
);
assert.ok(corePkg.exports, 'core/package.json declares exports');
assert.equal(corePkg.exports['./ui'], './src/ui/index.js');
assert.equal(corePkg.exports['./ui/tokens.css'], './src/ui/tokens.css');
assert.ok(corePkg.peerDependencies?.react, 'core declares react as peerDep');
assert.ok(corePkg.peerDependencies?.['react-dom'], 'core declares react-dom as peerDep');

for (const shell of ['extension', 'web']) {
    const pkg = JSON.parse(
        readFileSync(join(wsRoot, 'packages', shell, 'package.json'), 'utf8'),
    );
    assert.ok(
        pkg.dependencies?.react,
        `${shell}/package.json declares react dependency`,
    );
    assert.ok(
        pkg.dependencies?.['react-dom'],
        `${shell}/package.json declares react-dom dependency`,
    );
    assert.ok(
        pkg.devDependencies?.['@vitejs/plugin-react'],
        `${shell}/package.json declares @vitejs/plugin-react dev dep`,
    );
}

console.log(
    `OK — ui surface smoke (${components.length} primitives, tokens.css, core exports map, 2 shell dep wirings)`,
);
