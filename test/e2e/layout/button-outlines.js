// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Runs inside the page. Every visible button, as the buttons-outline spec
 * judges it: whether it is a shared Button (and with which variant and
 * size classes), whether it draws a button shape, and for a light button on
 * a light backdrop whether its edge shows. Plain function body: no closures
 * over Node values.
 */
export function measureButtons() {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    ctx.canvas.width = 1; ctx.canvas.height = 1;
    const rgba = (c) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top, bot) => [0, 1, 2].map((i) => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
    const lum = ([r, g, b]) => {
        const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    // The colour painted behind an element: its ancestors' fills composited
    // down to an opaque one (or white).
    const backdrop = (el) => {
        const layers = [];
        for (let a = el; a; a = a.parentElement) {
            const c = rgba(getComputedStyle(a).backgroundColor);
            if (c[3] > 0) layers.push(c);
            if (c[3] >= 1) break;
        }
        let base = [255, 255, 255, 1];
        for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
        return base;
    };
    const classes = (el) => [...el.classList];
    // CSS modules name a class _<local>_<hash>_<line> in dev and keep the
    // local name in production builds.
    const hasModuleClass = (el, local) => classes(el).some((c) => c === local || new RegExp(`^_?${local}_`).test(c) || c.endsWith(`_${local}`));
    const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'danger', 'success'];
    const SIZES = ['sm', 'md', 'lg'];
    const out = [];
    for (const el of document.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (!hit || !(hit === el || el.contains(hit))) continue; // covered by a dialog or sheet
        const shared = hasModuleClass(el, 'btn');
        const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().split('\n')[0].slice(0, 40);
        const own = rgba(cs.backgroundColor);
        const behind = backdrop(el.parentElement || el);
        const fill = own[3] > 0 ? over(own, behind) : behind;
        const borderWidth = parseFloat(cs.borderTopWidth) || 0;
        const borderColor = over(rgba(cs.borderTopColor), behind);
        const edgeContrast = borderWidth >= 1 && cs.borderTopStyle !== 'none' ? ratio(borderColor, behind) : 1;
        const shadow = cs.boxShadow && cs.boxShadow !== 'none';
        const outline = parseFloat(cs.outlineWidth) >= 1 && cs.outlineStyle !== 'none';
        out.push({
            name,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            shared,
            variants: VARIANTS.filter((v) => hasModuleClass(el, v)),
            sizes: SIZES.filter((s) => hasModuleClass(el, s)),
            iconOnly: hasModuleClass(el, 'iconOnly'),
            inHeader: Boolean(el.closest('header, nav')),
            h: Math.round(r.height),
            lightOnLight: lum(fill) > 0.85 && lum(behind) > 0.85,
            edgeContrast: Math.round(edgeContrast * 100) / 100,
            border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
            fill: `rgb(${fill.slice(0, 3).map(Math.round).join(', ')})`,
            shadow: Boolean(shadow),
            outline,
        });
    }
    return out;
}
