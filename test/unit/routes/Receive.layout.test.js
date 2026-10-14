// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.module.css'),
    'utf8',
);
const qrCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/QrDisplay.module.css'),
    'utf8',
);
const receive = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.jsx'),
    'utf8',
);

describe('Receive action layout', () => {
    it.each([360, 1280])('wraps whole one-line kit actions at %ipx', (viewportWidth) => {
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        expect(qrCss).toMatch(/\.actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
        expect(css).toMatch(
            /\.qrActions > \*\s*\{[^}]*flex:\s*0 0 auto;[^}]*height:\s*var\(--xc-control-h-md\);[^}]*white-space:\s*nowrap;/,
        );
        expect(css).toMatch(/\.qrActions > \* > span\s*\{[^}]*white-space:\s*nowrap;/);
        expect(css).not.toMatch(/\.qrActions\s*\{[^}]*flex-direction:\s*column;/);
        expect(receive).toMatch(/>\s*Copy QR\s*</);
        expect(receive).toMatch(/>\s*Share QR\s*</);
        expect(receive).toMatch(/>\s*Explorer\s*<span[^>]*>↗<\/span>/);
        expect(receive).toMatch(/aria-label="Generate new address"[\s\S]*?>\s*New address\s*</);
    });

    it('keeps field actions attached at the medium kit size', () => {
        expect(css).toMatch(
            /\.labelEditor\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*align-items:\s*end;/,
        );
        expect(css).not.toMatch(/@media[^}]+\{[\s\S]*?\.labelEditor\s*\{[^}]*grid-template-columns:\s*1fr;/);
        expect(css).toMatch(
            /\.amountEditor button\s*\{[^}]*--xc-button-height:\s*var\(--xc-control-h-md\);[^}]*min-height:\s*var\(--xc-control-h-md\);/,
        );
    });

    it('caps the complete QR box to the visible height on landscape phones', () => {
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) \{[\s\S]*?\.qrBox\s*\{[\s\S]*?max-width: min\(100%, calc\(var\(--xc-viewport-h, 100vh\) - 9rem\)\);[\s\S]*?margin-inline: auto;/,
        );
        // The receive QR box is also the shared QrDisplay frame, which owns its box model.
        const qrDisplayCss = readFileSync('packages/core/src/ui/QrDisplay.module.css', 'utf8');
        expect(qrDisplayCss).toMatch(/\.frame\s*\{[\s\S]*?box-sizing: border-box;/);
        expect(css).toMatch(
            /\.qr\s*\{[\s\S]*?width: 100%;[\s\S]*?height: auto;[\s\S]*?aspect-ratio: 1;/,
        );
    });
});
