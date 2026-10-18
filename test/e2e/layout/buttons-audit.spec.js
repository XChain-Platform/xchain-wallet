// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Buttons and controls audit: walks the demo-mode app and records, for every
// visible button, tab, switch, select and link-button, the box, type, border,
// outline and disabled look, plus whether it uses the shared Button classes.
// Findings are written to results.jsonl for a person to judge.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '../fixtures/wallet.js';
import { createSweep } from './sweep.js';

const OUT_ROOT = resolve(
    fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'tmp', 'buttons-audit',
    process.env.BUTTONS_SCHEME === 'dark' ? 'dark' : 'light',
);

export function auditControls() {
    const sel = 'button, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], select, a[href], summary';
    const out = [];
    const coarse = matchMedia('(pointer: coarse)').matches;
    for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const cls = String(el.className?.baseVal ?? el.className ?? '');
        const shared = /(^|\s)(_?btn|Button_btn|_btn_)/.test(cls) || /Button_|btn_/.test(cls);
        const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().split('\n')[0].slice(0, 40);
        out.push({
            tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', name, cls: cls.slice(0, 120),
            shared, coarse,
            w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
            pad: `${cs.paddingTop} ${cs.paddingRight}`, radius: cs.borderRadius,
            border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
            fs: cs.fontSize, fw: cs.fontWeight, bg: cs.backgroundColor, color: cs.color,
            disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
            opacity: cs.opacity, cursor: cs.cursor,
            svg: (() => { const s = el.querySelector('svg'); if (!s) return ''; const b = s.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; })(),
            parentTag: el.parentElement?.tagName.toLowerCase(),
        });
    }
    return out;
}

export function readFocused() {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const cls = String(el.className?.baseVal ?? el.className ?? '').replace(/_[A-Za-z0-9]{5,}\b/g, '');
    return {
        key: el.tagName + '|' + (el.getAttribute('role') || '') + '|' + cls,
        name: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('name') || '').trim().slice(0, 30),
        fv: el.matches(':focus-visible'),
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off ${cs.outlineOffset}`,
        shadow: cs.boxShadow.slice(0, 80), border: cs.borderTopColor,
    };
}

test('buttons and controls audit', async ({ page }, testInfo) => {
    test.setTimeout(45 * 60 * 1000);
    const sweep = createSweep(page, {
        venue: testInfo.project.name,
        outDir: resolve(OUT_ROOT, testInfo.project.name),
        onScreen: async (currentPage) => {
            const controls = await currentPage.evaluate(auditControls);
            await currentPage.evaluate(() => document.activeElement?.blur?.());
            const focus = [];
            for (let i = 0; i < 25; i += 1) {
                await currentPage.keyboard.press('Tab').catch(() => {});
                const f = await currentPage.evaluate(readFocused);
                if (!f) break;
                focus.push(f);
            }
            return { controls, focus };
        },
    });
    await sweep.onboarding({ demo: true });
    await sweep.unlocked();
});
