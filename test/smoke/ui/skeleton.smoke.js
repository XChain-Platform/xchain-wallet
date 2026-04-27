// Smoke for §37.1 / G118 — `<Skeleton>` loading-placeholder primitive.
//
// Verifies:
//   1. Skeleton.jsx + Skeleton.module.css exist and ship in the
//      `@xchain-wallet/core/ui` index.
//   2. Skeleton has the documented shape variants (row/text/title/
//      avatar/badge/card/tile) and exposes Skeleton.Row + Skeleton.List
//      composites.
//   3. Skeleton renders aria-hidden by default; supplying ariaLabel
//      flips it to role="status" + aria-label so callers can opt-in to
//      assistive-tech announcement.
//   4. CSS turns the shimmer animation off under
//      `prefers-reduced-motion: reduce` (§53 a11y).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ui = join(wsRoot, 'packages', 'core', 'src', 'ui');

const jsxPath = join(ui, 'Skeleton.jsx');
const cssPath = join(ui, 'Skeleton.module.css');
const indexPath = join(ui, 'index.js');

assert.ok(existsSync(jsxPath), 'Skeleton.jsx exists');
assert.ok(existsSync(cssPath), 'Skeleton.module.css exists');

const src = readFileSync(jsxPath, 'utf8');

// Named export + composites.
assert.ok(/export function Skeleton\b/.test(src), 'Skeleton is a named export');
assert.ok(/Skeleton\.Row\s*=\s*SkeletonRow/.test(src), 'Skeleton.Row composite is attached');
assert.ok(/Skeleton\.List\s*=\s*SkeletonList/.test(src), 'Skeleton.List composite is attached');

// Shape variants enumerated in SHAPE_CLASS.
for (const shape of ['row', 'text', 'title', 'avatar', 'badge', 'card', 'tile']) {
    assert.ok(
        new RegExp(`(['"])?${shape}\\1?:\\s*styles\\.shape`).test(src),
        `SHAPE_CLASS maps '${shape}'`,
    );
}

// aria-hidden by default; ariaLabel opts into role="status" + aria-label.
assert.ok(
    /aria-hidden="true"/.test(src),
    'Skeleton sets aria-hidden by default so screen readers skip placeholders',
);
assert.ok(
    /role="status"/.test(src) && /aria-label=\{ariaLabel\}/.test(src),
    'Skeleton flips to role="status" + aria-label when ariaLabel is supplied',
);

// `width` / `height` props turn into inline pixel strings when numeric.
assert.ok(
    /typeof width === 'number'/.test(src) && /typeof height === 'number'/.test(src),
    'Skeleton coerces numeric width/height props to px',
);

// CSS — keyframes + reduced-motion guard.
const cssSrc = readFileSync(cssPath, 'utf8');
assert.ok(/@keyframes\s+xc-skeleton-shimmer/.test(cssSrc), 'CSS defines the shimmer keyframes');
assert.ok(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(cssSrc),
    'CSS guards the animation behind prefers-reduced-motion',
);
assert.ok(
    /animation:\s*none/.test(cssSrc),
    'CSS disables the animation under reduced-motion (§53 a11y)',
);

// `@xchain-wallet/core/ui` re-exports Skeleton so callers can `import { Skeleton } from '@xchain-wallet/core/ui'`.
const indexSrc = readFileSync(indexPath, 'utf8');
assert.ok(
    /export\s*\{\s*Skeleton\s*\}\s*from\s*['"]\.\/Skeleton\.jsx['"]/.test(indexSrc),
    'core/ui index re-exports Skeleton',
);
