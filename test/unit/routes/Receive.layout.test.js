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
    it.each([360, 1280])('shares one left-aligned content width at %ipx', (viewportWidth) => {
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        expect(css).toMatch(
            /\.receiveQrDisplay > \*\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
        );
        // The QR card spans the form; only the code inside it is capped.
        expect(css).toMatch(/\.qrBox\s*\{[^}]*max-width:\s*none;/);
        expect(css).toMatch(
            /\.qrSurface\s*\{[^}]*max-width:\s*var\(--xc-qr-frame-size\);[^}]*margin-inline:\s*auto;/,
        );
        expect(receive).toMatch(
            /qrStyles\.frame[\s\S]*?<AddressField[\s\S]*?\{qrActionsContent\}/,
        );
    });

    it.each([360, 1280])('wraps whole one-line kit secondary actions at %ipx', (viewportWidth) => {
        const actionSource = receive.match(
            /const generateAddressButton[\s\S]*?const body/,
        )?.[0] || '';
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        expect(qrCss).toMatch(/\.actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
        // Receive overrides the shared row with two equal columns of one height.
        expect(css).toMatch(
            /\.qrActions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
        );
        expect(css).toMatch(
            /\.qrActions > \*\s*\{[^}]*width:\s*100%;[^}]*height:\s*var\(--xc-control-h-md\);[^}]*white-space:\s*nowrap;/,
        );
        expect(css).toMatch(/\.qrActions > \* > span\s*\{[^}]*white-space:\s*nowrap;/);
        expect(css).not.toMatch(/\.qrActions\s*\{[^}]*flex-direction:\s*column;/);
        expect(receive).toMatch(/>\s*Copy QR\s*</);
        expect(receive).toMatch(/>\s*Share QR\s*</);
        expect(receive).toMatch(/>\s*Explorer\s*<span[^>]*>↗<\/span>/);
        expect(receive).toMatch(/aria-label="Generate new address"[\s\S]*?>\s*New address\s*</);
        expect(actionSource.match(/variant="secondary"/g)).toHaveLength(3);
        expect(css).toMatch(
            /\.explorerLink\s*\{[^}]*composes:\s*btn secondary md from '\.\.\/\.\.\/ui\/Button\.module\.css';/,
        );
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

    it('caps the complete QR column to the visible height on landscape phones', () => {
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) \{[\s\S]*?\.qrSurface\s*\{[\s\S]*?max-width: min\(var\(--xc-qr-frame-size\), calc\(var\(--xc-viewport-h, 100vh\) - 11rem\)\);/,
        );
        // The receive QR box is also the shared QrDisplay frame, which owns its box model.
        const qrDisplayCss = readFileSync('packages/core/src/ui/QrDisplay.module.css', 'utf8');
        expect(qrDisplayCss).toMatch(/\.frame\s*\{[\s\S]*?box-sizing: border-box;/);
        expect(css).toMatch(
            /\.qr\s*\{[\s\S]*?width: 100%;[\s\S]*?height: auto;[\s\S]*?aspect-ratio: 1;/,
        );
    });
});
