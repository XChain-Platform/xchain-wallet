// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withEnglishCopy } from '../../helpers/englishSource.js';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.module.css'),
    'utf8',
);
const qrCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/QrDisplay.module.css'),
    'utf8',
);
const receive = withEnglishCopy(readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/Receive.jsx'),
    'utf8',
));

describe('Receive action layout', () => {
    it.each([360, 1280])('shares one left-aligned content width at %ipx', (viewportWidth) => {
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        expect(css).toMatch(
            /\.receiveQrDisplay > \*\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
        );
        // The form already supplies the card, so only the unframed code is capped.
        expect(css).not.toMatch(/\.qrBox\s*\{/);
        expect(css).toMatch(
            /\.qrSurface\s*\{[^}]*max-width:\s*min\(var\(--xc-qr-frame-size\), var\(--xc-qr-fit-size, var\(--xc-qr-frame-size\)\)\);[^}]*margin-inline:\s*auto;/,
        );
        expect(receive).toMatch(
            /styles\.qrSurface[\s\S]*?<AddressField[\s\S]*?\{qrActionsContent\}/,
        );
    });

    it('keeps only the QR, address, asset, amount and four actions in the receive stack', () => {
        const stack = receive.match(/className=\{`\$\{qrStyles\.stack\} \$\{styles\.receiveQrDisplay\}`\}>[\s\S]*?\{qrActionsContent\}/)?.[0] || '';
        expect(stack).not.toBe('');
        // QR first, then the three fields the user changes, then the actions.
        const order = ['styles.qrSurface', '<AddressField', '<TokenField', '<AmountField', '{qrActionsContent}']
            .map((marker) => stack.indexOf(marker));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        const addressField = stack.match(/<AddressField[\s\S]*?\/>/)?.[0] || '';
        // The plain Address label: no address name, no tap-to-copy tooltip or help tip.
        expect(addressField).toMatch(/label=\{t\('verifySignature\.address'\)\}|label="Address"/);
        expect(addressField).not.toContain('address.label');
        expect(addressField).not.toMatch(/\btitle=/);
        expect(addressField).not.toMatch(/\bhelp=/);
        expect(receive).not.toContain('tapToCopyAddress');
        expect(receive).not.toContain('tapTheAddressToCopy');
    });

    it.each([360, 1280])('wraps whole one-line kit secondary actions at %ipx', (viewportWidth) => {
        const actionSource = receive.match(
            /const generateAddressButton[\s\S]*?const body/,
        )?.[0] || '';
        expect(viewportWidth).toBeGreaterThanOrEqual(360);
        expect(qrCss).toMatch(/\.actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
        // Receive keeps the shared wrapping row: two equal buttons of one height per
        // row, and a pair that large text makes wider than the form wraps whole
        // instead of clipping its label past the form's edge.
        // The redesign puts Copy, Share, Explore and New four across in one grid row at every
        // width, with short labels and no side padding so each fits a quarter of a 360px form.
        expect(css).toMatch(/\.qrActions\.qrActions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
        expect(css).toMatch(
            /\.qrActions\.qrActions > \*\s*\{[^}]*min-width:\s*0;[^}]*height:\s*var\(--xc-control-h-md\);[^}]*white-space:\s*nowrap;/,
        );
        expect(css).toMatch(/\.qrActions > \* > span\s*\{[^}]*white-space:\s*nowrap;/);
        expect(css).not.toMatch(/\.qrActions(?:\.qrActions)?\s*\{[^}]*flex-direction:\s*column;/);
        // Copy and Share read their short labels from shared keys.
        expect(receive).toMatch(/\{t\('common\.copy'\)\}\s*<\/Button>/);
        expect(receive).toMatch(/\{t\('multisig\.signingLink\.share'\)\}\s*<\/Button>/);
        expect(receive).toMatch(/<span className=\{buttonStyles\.label\}>Explore<\/span>/);
        // The source reads with swept t() calls as English (withEnglishCopy).
        expect(receive).toMatch(/aria-label="Generate new address"[\s\S]*?>\s*New\s*</);
        expect(actionSource.match(/variant="secondary"/g)).toHaveLength(3);
        // The explorer link takes the secondary medium button look from markup;
        // a composes would put a second Button.module.css into Receive's chunk.
        expect(css).not.toMatch(/composes:[^;]*Button\.module\.css/);
        expect(receive).toMatch(
            /className=\{`\$\{buttonStyles\.btn\} \$\{buttonStyles\.secondary\} \$\{buttonStyles\.md\} \$\{styles\.explorerLink\}`\}/,
        );
    });

    it('keeps field actions attached at the medium kit size', () => {
        // The redesign retired the label editor row; the amount editor's buttons keep the medium size.
        expect(css).not.toContain('.labelEditor');
        expect(css).toMatch(
            /\.amountEditor button\s*\{[^}]*--xc-button-height:\s*var\(--xc-control-h-md\);[^}]*min-height:\s*var\(--xc-control-h-md\);/,
        );
    });

    it('caps the complete QR column to the visible height on landscape phones', () => {
        expect(css).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 3\/2\) \{[\s\S]*?\.qrSurface\s*\{[\s\S]*?max-width: min\(var\(--xc-qr-frame-size\), var\(--xc-qr-fit-size, var\(--xc-qr-frame-size\)\), calc\(var\(--xc-viewport-h, 100vh\) - 11rem\)\);/,
        );
        expect(receive).not.toContain('qrStyles.frame');
        expect(css).toMatch(
            /\.qr\s*\{[\s\S]*?width: 100%;[\s\S]*?height: auto;[\s\S]*?aspect-ratio: 1;/,
        );
    });
});
