// Smoke for §54 / G174 CSS logical properties (RTL). Sweeps every
// *.module.css under packages/ and asserts no physical inline-axis
// properties remain. Catches drift the moment a future CSS edit
// reintroduces `margin-left:` / `padding-right:` / etc.
//
// What we check (banned in module.css, anywhere):
//   margin-left: / margin-right:
//   padding-left: / padding-right:
//   border-left[-color/style/width]: / border-right[-color/style/width]:
//   border-top-left-radius: / border-top-right-radius:
//   border-bottom-left-radius: / border-bottom-right-radius:
//   text-align: left / text-align: right
//
// What we check at start-of-line (banned only as a property):
//   left:  → use inset-inline-start
//   right: → use inset-inline-end
//
// What we leave alone (top: / bottom: / cursor: ew-resize / flex-direction:
// row[-reverse] etc.) — these are either block-direction (already
// RTL-safe) or physically intentional.

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (entry.endsWith('.module.css')) out.push(p);
    }
    return out;
}

const cssFiles = walk(join(root, 'packages'));
assert.ok(cssFiles.length > 0, 'at least one *.module.css file in packages/');

const physicalProperty = /(?:^|\n)\s*(margin-(?:left|right)|padding-(?:left|right)|border-(?:left|right)(?:-(?:color|style|width))?|border-top-(?:left|right)-radius|border-bottom-(?:left|right)-radius)\s*:/;
const physicalPosition = /(?:^|\n)[ \t]*(?:left|right)\s*:/;
const physicalTextAlign = /text-align\s*:\s*(left|right)\b/;

const violations = [];
for (const f of cssFiles) {
    const src = readFileSync(f, 'utf8');
    const rel = f.replace(`${root}/`, '');
    if (physicalProperty.test(src)) {
        const match = src.match(physicalProperty);
        violations.push(`${rel}: physical inline-axis property "${match[1]}"`);
    }
    if (physicalPosition.test(src)) {
        violations.push(`${rel}: physical inset position "left:" or "right:" — use inset-inline-start/end`);
    }
    if (physicalTextAlign.test(src)) {
        const match = src.match(physicalTextAlign);
        violations.push(`${rel}: text-align: ${match[1]} — use text-align: start / end`);
    }
}

if (violations.length > 0) {
    console.error('Physical CSS properties detected:');
    for (const v of violations) console.error('  - ' + v);
    process.exit(1);
}

// Sanity check: at least one logical property must be in use somewhere
// — guards against a future "no module.css imports anything" regression
// that would silently pass the negative-only test above.
let logicalCount = 0;
for (const f of cssFiles) {
    const src = readFileSync(f, 'utf8');
    if (/(?:margin|padding|border)-inline-(?:start|end)|inset-inline-(?:start|end)|text-align:\s*(?:start|end)\b/.test(src)) {
        logicalCount += 1;
    }
}
assert.ok(logicalCount > 0,
    'at least one *.module.css uses logical properties (sanity check)');

console.log(`OK — ${cssFiles.length} *.module.css files clean of physical inline-axis properties; ${logicalCount} use logical equivalents`);
