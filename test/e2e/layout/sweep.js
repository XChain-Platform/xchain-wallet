// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Layout sweep: walk every screen the wallet can reach and measure it for the
// faults a user sees but no functional test catches - content off the edge of
// the screen, text cut off by a clipping parent, a page that scrolls sideways,
// panels that scroll when they should fit, content below the fold that
// nothing lets you reach, and controls drawn over each other.
//
// It runs the same walk in every venue (Chromium at Android sizes, WebKit at
// iPhone and iPad sizes, the Electron desktop app at several window sizes),
// writes one JSON line and one screenshot per screen, and never fails a test
// on a finding: findings are for a person to judge, because some scrolling is
// meant to be there.

import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    completeRecoveryPhraseChallenge, dismissIntroCarousel, gotoSection, nav, openSettings,
    readRecoveryPhrase, unlockedShell,
} from '../fixtures/wallet.js';

/** Names never clicked: they lock, delete, reset, or leave the wallet. */
const DESTRUCTIVE = /lock|remove|delete|reset|wipe|erase|sign ?out|log ?out|forget|revoke|uninstall|export|backup|reveal|show (seed|recovery)|recovery phrase|private key|clear (all|data)|factory/i;

/**
 * Runs inside the page. Returns what is wrong with the current screen.
 * Plain function body: no closures over Node values.
 */
export function measureInPage(opts = {}) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const se = document.scrollingElement || document.documentElement;
    const desc = (el) => {
        let s = el.tagName.toLowerCase();
        const cls = [...el.classList].slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
        const label = el.getAttribute('aria-label')
            || (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
        if (label) s += ` "${label}"`;
        return s;
    };
    const scrollable = (v) => v === 'auto' || v === 'scroll' || v === 'overlay';
    const res = {
        vw,
        vh,
        title: (document.querySelector('h1, [class*="title"]')?.textContent || '').trim().slice(0, 60),
        pageScrollX: Math.max(0, se.scrollWidth - se.clientWidth),
        pageScrollY: Math.max(0, se.scrollHeight - se.clientHeight),
        offscreen: [],
        clipped: [],
        unreachable: [],
        xScrollers: [],
        yScrollers: [],
    };
    if (opts.contrast) { res.lowContrast = []; res.lightSurfaces = []; }
    const seen = new Set();
    const push = (list, item) => {
        const key = `${list}|${item.el}`;
        if (seen.has(key) || res[list].length >= 15) return;
        seen.add(key);
        res[list].push(item);
    };
    for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        // A 1x1 box is the visually-hidden pattern (.sr-only, the skip link
        // before it has focus): text for screen readers, never seen. WebKit
        // reports it a hair over 1px under page zoom.
        if (r.width < 1.5 && r.height < 1.5) continue;
        if (scrollable(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
            push('xScrollers', { el: desc(el), by: el.scrollWidth - el.clientWidth, w: Math.round(r.width) });
        }
        if (scrollable(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
            push('yScrollers', { el: desc(el), by: el.scrollHeight - el.clientHeight, h: Math.round(r.height) });
        }
        // The part of the element that can actually be seen after every
        // clipping ancestor, and whether any ancestor scrolls vertically.
        let L = r.left; let R = r.right; let T = r.top; let B = r.bottom;
        let clipX = null; let inYScroller = false; let fixed = cs.position === 'fixed';
        for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            const acs = getComputedStyle(a);
            const ar = a.getBoundingClientRect();
            if (acs.overflowX !== 'visible') {
                if (L < ar.left || R > ar.right) clipX = clipX || a;
                L = Math.max(L, ar.left); R = Math.min(R, ar.right);
            }
            if (acs.overflowY !== 'visible') {
                if (scrollable(acs.overflowY)) inYScroller = true;
                T = Math.max(T, ar.top); B = Math.min(B, ar.bottom);
            }
            if (acs.position === 'fixed') { fixed = true; break; }
        }
        if (R - L < 1 || B - T < 1) continue; // scrolled out of its own scroller: fine
        const leaf = el.children.length === 0
            || ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'svg', 'CANVAS', 'VIDEO'].includes(el.tagName);
        if (!leaf) continue;
        if (R > vw + 1 || L < -1) {
            push('offscreen', { el: desc(el), left: Math.round(L), right: Math.round(R) });
        } else if (clipX && (r.right > R + 2 || r.left < L - 2)) {
            const ccs = getComputedStyle(clipX);
            if (ccs.overflowX === 'hidden' || ccs.overflowX === 'clip') {
                push('clipped', { el: desc(el), by: desc(clipX), cut: Math.round(Math.max(r.right - R, L - r.left)) });
            }
        }
        // Text painted transparent is not seen, so it cannot be seen cut: a
        // read-only address input keeps its full value that way under the
        // shortened overlay that shows it.
        const transparentText = /^rgba\(.*,\s*0\)$|^transparent$/.test(cs.color);
        if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.children.length === 0
            && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !transparentText) {
            push('clipped', { el: desc(el), by: 'itself', cut: el.scrollWidth - el.clientWidth });
        }
        if (!fixed && !inYScroller && res.pageScrollY === 0 && B > vh + 1) {
            push('unreachable', { el: desc(el), top: Math.round(T), bottom: Math.round(B) });
        }
    }
    res.layout = measureLayout();
    res.narrow = measureNarrowLists();
    res.overlaps = measureOverlaps();
    if (opts.contrast) measureContrast();
    return res;

    // Controls drawn over each other: an in-field icon that a wider Paste
    // button runs into at large text, say. Only controls a tap can reach at
    // their own centre count, so a menu or dialog laid over the page (which
    // covers the page's controls by design) is not an overlap; and only
    // controls in the same scroller, so a row scrolling under the fixed
    // navigation bar is not one either.
    function measureOverlaps() {
        const found = [];
        const scrollerOf = (el) => {
            for (let a = el.parentElement; a; a = a.parentElement) {
                const acs = getComputedStyle(a);
                if (scrollable(acs.overflowY) || scrollable(acs.overflowX)) return a;
                if (acs.position === 'fixed') return a;
            }
            return null;
        };
        const controls = [...document.querySelectorAll(
            'button, a[href], [role="button"], select, input[type="checkbox"], input[type="radio"]',
        )].filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1.5 || r.height < 1.5) return false;
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > vw || y > vh) return false;
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && (hit === el || el.contains(hit)));
        });
        for (let i = 0; i < controls.length && found.length < 15; i += 1) {
            for (let j = i + 1; j < controls.length && found.length < 15; j += 1) {
                const a = controls[i];
                const b = controls[j];
                if (a.contains(b) || b.contains(a)) continue;
                if (scrollerOf(a) !== scrollerOf(b)) continue;
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                // A control laid wholly inside another (a row's trailing Info
                // or Rename button) is that row's own action, drawn there on
                // purpose; two controls that only partly cover each other are
                // the collision this looks for.
                const inside = (inner, outer) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5
                    && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
                if (inside(ra, rb) || inside(rb, ra)) continue;
                if (w > 2 && h > 2) found.push({ el: desc(a), with: desc(b), w: Math.round(w), h: Math.round(h) });
            }
        }
        return found;
    }

    // The route contract is measured from the main scroller's inner border.
    // This keeps a left navigation rail out of page-gutter coordinates and
    // puts the right measurement against the scrollbar's real leading edge.
    function measureLayout() {
        const main = document.getElementById('xc-main');
        if (!main) return null;
        const mcs = getComputedStyle(main);
        const mr = main.getBoundingClientRect();
        const borderL = main.clientLeft;
        const borderR = parseFloat(mcs.borderRightWidth) || 0;
        const padL = parseFloat(mcs.paddingLeft) || 0;
        const padR = parseFloat(mcs.paddingRight) || 0;
        const frameLeft = mr.left + borderL;
        const scrollbarWidth = Math.max(0, mr.width - borderL - borderR - main.clientWidth);
        const scrollbarLeft = mr.right - borderR - scrollbarWidth;
        const contentLeft = frameLeft + padL;
        const contentRight = frameLeft + main.clientWidth - padR;
        // One 12px page gutter at every width (--xc-page-gutter); kept in
        // step with PAGE_GUTTER_PX by hand, since this body runs in the page.
        const expectedGutter = 12;
        const visible = (el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return cs.display !== 'none' && cs.visibility !== 'hidden'
                && cs.position !== 'absolute' && cs.position !== 'fixed'
                && r.width >= 1 && r.height >= 1;
        };
        const first = [...main.children].find(visible) || null;
        const fr = first?.getBoundingClientRect();
        const form = first && (first.tagName === 'FORM' || first.getAttribute('role') === 'group');
        const shell = main.parentElement;
        const header = shell ? [...shell.children].find((el) => el.tagName === 'HEADER' && visible(el)) : null;
        const headerFirst = header ? [...header.children].find(visible) : null;
        const hr = headerFirst?.getBoundingClientRect();
        const round = (value) => Math.round(value * 100) / 100;
        return {
            expectedGutter,
            contentLeft: round(contentLeft - frameLeft),
            contentRightGap: round(scrollbarLeft - contentRight),
            first: first ? {
                el: desc(first),
                kind: form ? 'form' : 'list',
                left: round(fr.left - frameLeft),
                rightGap: round(scrollbarLeft - fr.right),
                topGap: round(fr.top - mr.top + main.scrollTop - main.clientTop),
            } : null,
            headerLeft: hr ? round(hr.left - frameLeft) : null,
            tier: main.closest('[data-xc-tier]')?.getAttribute('data-xc-tier') ?? null,
        };
    }

    // Dark-mode legibility. WCAG 2.x contrast of each visible text element's
    // computed colour against the nearest opaque ancestor background (alpha
    // layers are composited down to it), and any painted surface that is
    // still light inside a dark app, which is how a hard-coded #fff panel
    // shows up. Backgrounds drawn as images or gradients cannot be sampled,
    // so text over one is skipped rather than guessed at.
    function measureContrast() {
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        ctx.canvas.width = 1; ctx.canvas.height = 1;
        // Any CSS colour syntax to [r, g, b, a], via the canvas so that
        // color(srgb ...) and named colours resolve like rgb().
        const rgba = (c) => {
            const m = /^rgba?\(([^)]+)\)$/.exec(c);
            if (m && !m[1].includes('/')) {
                const p = m[1].split(',').map((x) => parseFloat(x));
                if (p.length >= 3 && p.every((x) => !Number.isNaN(x))) return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
            }
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return [d[0], d[1], d[2], d[3] / 255];
        };
        const over = (top, bot) => {
            const a = top[3];
            return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1);
        };
        const lum = ([r, g, b]) => {
            const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a, b) => {
            const la = lum(a); const lb = lum(b);
            return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        };
        // The effective backdrop of an element, or null when an ancestor
        // paints an image or gradient over it.
        const backdrop = (el) => {
            const layers = [];
            for (let a = el; a; a = a.parentElement) {
                const acs = getComputedStyle(a);
                if (acs.backgroundImage !== 'none') return null;
                const c = rgba(acs.backgroundColor);
                if (c[3] > 0) layers.push(c);
                if (c[3] >= 1) break;
            }
            let base = [255, 255, 255, 1];
            const root = rgba(getComputedStyle(document.documentElement).backgroundColor);
            if (root[3] > 0) base = over(root, base);
            const body = rgba(getComputedStyle(document.body).backgroundColor);
            if (body[3] > 0) base = over(body, base);
            for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i], base);
            return base;
        };
        const seenText = new Set();
        const seenSurf = new Set();
        for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const bgc = rgba(cs.backgroundColor);
            // Images, canvases and SVG are painted by their own pixels (a QR code
            // keeps a white quiet zone on purpose); only CSS fills count.
            if (!/^(IMG|CANVAS|SVG|VIDEO|PICTURE)$/i.test(el.tagName) && bgc[3] > 0.5 && r.width >= 16 && r.height >= 16 && cs.backgroundImage === 'none'
                && lum(bgc) > 0.8 && res.lightSurfaces.length < 25) {
                const key = desc(el);
                if (!seenSurf.has(key)) {
                    seenSurf.add(key);
                    res.lightSurfaces.push({ el: key, bg: cs.backgroundColor, lum: Number(lum(bgc).toFixed(2)) });
                }
            }
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!hasText) continue;
            if (el.closest('svg, canvas, [aria-hidden="true"]')) continue;
            const disabled = el.matches(':disabled') || el.closest('[aria-disabled="true"], :disabled');
            if (disabled) continue; // WCAG exempts inactive controls
            const bg = backdrop(el);
            if (!bg) continue;
            const fg = rgba(cs.color);
            const eff = over(fg, bg);
            const cr = ratio(eff, bg);
            const px = parseFloat(cs.fontSize);
            const bold = Number(cs.fontWeight) >= 700;
            const large = px >= 24 || (px >= 18.66 && bold);
            const need = large ? 3 : 4.5;
            if (cr < need && res.lowContrast.length < 40) {
                const key = desc(el);
                if (seenText.has(key)) continue;
                seenText.add(key);
                res.lowContrast.push({ el: key, ratio: Number(cr.toFixed(2)), need, color: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})` });
            }
        }
    }

    // Lists, cards and tables fill the content area's usable width, up to
    // the scrollbar (operator ruling 2026-10-12); forms keep their own
    // narrower column. The usable width is the main scroller's clientWidth,
    // which excludes a classic scrollbar, less its own horizontal padding.
    // A list is judged by the outermost box around it that draws an edge,
    // since a list inset by its own card's padding is how a card looks; a
    // block sharing its row with siblings (a grid of cards) is judged by
    // the row; and anything holding a form control is a form.
    function measureNarrowLists() {
        const main = document.getElementById('xc-main');
        let scroller = main;
        for (let a = main; a; a = a.parentElement) {
            const ox = getComputedStyle(a).overflowY;
            if (scrollable(ox)) { scroller = a; break; }
        }
        if (!scroller) return [];
        const scs = getComputedStyle(scroller);
        const sr = scroller.getBoundingClientRect();
        const padL = parseFloat(scs.paddingLeft) || 0;
        const padR = parseFloat(scs.paddingRight) || 0;
        const usable = scroller.clientWidth - padL - padR;
        const left = sr.left + (parseFloat(scs.borderLeftWidth) || 0) + padL;
        const LISTY = /(^|_|-)(list|lists|card|cards|table|items|grid|panel|feed|results)(_|-|$)/i;
        const BLOCK = /^(block|flex|grid|table|list-item|flow-root)$/;
        const isCandidate = (el) => {
            if (!BLOCK.test(getComputedStyle(el).display)) return false;
            const role = el.getAttribute('role');
            if (role === 'list' || role === 'table' || role === 'grid') return true;
            if (['UL', 'OL', 'TABLE'].includes(el.tagName)) return true;
            return [...el.classList].some((c) => LISTY.test(c));
        };
        // A box that draws an edge: a border, or a background that differs
        // from the page's own (a wrapper painted in the page colour draws
        // nothing a user can see).
        const clear = (bg) => !bg || bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg);
        let pageBg = null;
        for (let a = scroller; a && !pageBg; a = a.parentElement) {
            const bg = getComputedStyle(a).backgroundColor;
            if (!clear(bg)) pageBg = bg;
        }
        const isBox = (el) => {
            const cs = getComputedStyle(el);
            const bg = cs.backgroundColor;
            return parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0
                || (!clear(bg) && bg !== pageBg);
        };
        // A search or filter box above a list does not make the list a form.
        const isFilter = (c) => c.type === 'search' || c.getAttribute('role') === 'searchbox'
            || c.tagName === 'SELECT'
            || /search|filter/i.test(`${c.getAttribute('aria-label') || ''} ${c.getAttribute('placeholder') || ''}`);
        const isFormish = (el) => el.closest('form, dialog, [role="dialog"], [role="alertdialog"]')
            || el.querySelector('form, textarea, button[type="submit"]')
            || [...el.querySelectorAll('input, select')].some((c) => !isFilter(c));
        const out = [];
        const judged = new Set();
        for (const el of scroller.querySelectorAll('*')) {
            if (!isCandidate(el)) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') continue;
            const r0 = el.getBoundingClientRect();
            if (r0.width < 1 || r0.height < 1) continue;
            // Judge the outermost edge-drawing box around the list, or the
            // list itself when nothing around it draws an edge: a list inset
            // by its own card's padding is how a card looks.
            let target = el;
            let nested = false;
            for (let a = el.parentElement; a && a !== scroller; a = a.parentElement) {
                if (isCandidate(a)) nested = true;
                if (isBox(a)) target = a;
            }
            if (nested || judged.has(target) || isFormish(target)) continue;
            judged.add(target);
            // A cell of a grid is judged by its grid, whose last row may
            // hold a single cell by design.
            const parent = target.parentElement;
            if (parent && parent !== scroller && /grid/.test(getComputedStyle(parent).display)) {
                if (judged.has(parent)) continue;
                judged.add(parent);
                target = parent;
            }
            const r = target.getBoundingClientRect();
            // The row this block sits in: siblings overlapping it vertically.
            let rowL = r.left; let rowR = r.right;
            for (const sib of target.parentElement ? target.parentElement.children : []) {
                if (sib === target) continue;
                const sr2 = sib.getBoundingClientRect();
                if (sr2.width < 1 || sr2.bottom <= r.top || sr2.top >= r.bottom) continue;
                rowL = Math.min(rowL, sr2.left); rowR = Math.max(rowR, sr2.right);
                judged.add(sib);
            }
            const short = Math.round(usable - (rowR - rowL));
            if (short > 2) {
                out.push({ el: desc(target), w: Math.round(rowR - rowL), usable: Math.round(usable), short, offset: Math.round(rowL - left) });
                if (out.length >= 15) break;
            }
        }
        return out;
    }
}

/** Returns inconsistent interactive controls that occupy the same visual row. */
export function measureControlRows() {
    const selector = [
        'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
        '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
        '[role="switch"]', '[role="combobox"]', '[role="tab"]', '[role="menuitem"]',
    ].join(',');
    // A control 2px or less across is visually hidden (a skip link before
    // focus, the native input under a drawn radio), so nobody sees it in a row.
    const visible = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
            && r.width > 2 && r.height > 2
            && !el.matches(':disabled, [aria-disabled="true"]');
    };
    // A row lives inside one region: a landmark, a dialog or menu, or a
    // fixed or sticky layer. The sidebar beside the page, the bottom tab bar
    // over scrolled content and a sticky header over a list share a flex or
    // grid shell with the content, yet their controls never form a row with
    // it.
    const regionSelector = [
        'main', 'nav', 'aside', 'header', 'footer', 'dialog',
        '[role="main"]', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '[role="complementary"]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]',
    ].join(',');
    const regionOf = (el) => {
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
            if (node.matches(regionSelector)) return node;
            if (/^(fixed|sticky)$/.test(getComputedStyle(node).position)) return node;
        }
        return document.body;
    };
    // Nested interactive markup represents one control even when both the
    // wrapper and its implementation carry an interactive role.
    const controls = [...document.querySelectorAll(selector)].filter((el) => (
        visible(el) && !el.parentElement?.closest(selector)
    ));
    // A control with no background and no full border draws no box: an
    // underlined text link in a sentence, an underline tab. Its height and
    // corner radius never show, so only its type is held to the row.
    const clear = (colour) => !colour || colour === 'transparent' || /^rgba\(.*,\s*0\)$/.test(colour);
    const drawsBox = (cs) => !clear(cs.backgroundColor) || ['Top', 'Right', 'Bottom', 'Left'].every((side) => (
        parseFloat(cs[`border${side}Width`]) > 0
        && !/^(none|hidden)$/.test(cs[`border${side}Style`])
        && !clear(cs[`border${side}Color`])
    ));
    const records = controls.map((el) => {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const text = (el.innerText ?? el.textContent ?? '').trim();
        const buttonLike = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
        const name = el.getAttribute('aria-label') || text.replace(/\s+/g, ' ').slice(0, 48)
            || el.getAttribute('name') || el.tagName.toLowerCase();
        // A tab is one stop of its tab strip: the strip's outline is what
        // sits beside the next control, and the selected tab's tint is a
        // state inside it, so a tab takes the strip's box and radius.
        const strip = el.getAttribute('role') === 'tab' ? el.closest('[role="tablist"]') : null;
        const surface = strip ? getComputedStyle(strip) : cs;
        return {
            el,
            region: regionOf(el),
            rect,
            height: rect.height,
            radius: surface.borderRadius,
            fontSize: cs.fontSize,
            box: drawsBox(surface),
            iconOnly: buttonLike && text.length === 0,
            desc: `${el.tagName.toLowerCase()} "${name}"`,
        };
    });
    const sameRow = (a, b) => {
        if (a.region !== b.region) return false;
        const horizontallySeparate = a.rect.right <= b.rect.left + 1 || b.rect.right <= a.rect.left + 1;
        const overlap = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        return horizontallySeparate && overlap >= Math.min(a.rect.height, b.rect.height) / 2;
    };
    const commonAncestor = (a, b) => {
        const ancestors = new Set();
        for (let el = a.parentElement; el; el = el.parentElement) ancestors.add(el);
        for (let el = b.parentElement; el; el = el.parentElement) if (ancestors.has(el)) return el;
        return null;
    };
    const isRowContainer = (el, a, b) => {
        if (!el || el === document.body || el === document.documentElement) return false;
        const cs = getComputedStyle(el);
        const role = el.getAttribute('role');
        if (['group', 'toolbar', 'tablist', 'radiogroup', 'menu', 'navigation'].includes(role)) return true;
        if (['NAV', 'FIELDSET'].includes(el.tagName)) return true;
        if (cs.display === 'grid' || cs.display === 'inline-grid') return true;
        if ((cs.display === 'flex' || cs.display === 'inline-flex') && cs.flexDirection !== 'column') return true;
        return a.el.parentElement === el && b.el.parentElement === el;
    };

    const grouped = new Map();
    for (let i = 0; i < records.length; i += 1) {
        for (let j = i + 1; j < records.length; j += 1) {
            const a = records[i];
            const b = records[j];
            if (!sameRow(a, b)) continue;
            const container = commonAncestor(a.el, b.el);
            if (!isRowContainer(container, a, b)) continue;
            let rows = grouped.get(container);
            if (!rows) {
                rows = [];
                grouped.set(container, rows);
            }
            let row = rows.find((candidate) => [...candidate].some((item) => sameRow(item, a) || sameRow(item, b)));
            if (!row) {
                row = new Set();
                rows.push(row);
            }
            row.add(a);
            row.add(b);
        }
    }

    // A row that spills: a control past its row container's edge or past the
    // window. Rows that scroll sideways on purpose (tab strips, chip
    // scrollers) are left alone, and so is a control parked wholly off screen
    // until focused (a skip link).
    const viewportWidth = document.documentElement.clientWidth;
    const scrollsSideways = (el) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
    const parkedOffScreen = (item) => item.rect.right <= 0 || item.rect.left >= viewportWidth;
    const spills = (container, items) => {
        if (scrollsSideways(container)) return false;
        const box = container.getBoundingClientRect();
        return items.some((item) => !parkedOffScreen(item)
            && (item.rect.left < Math.max(box.left, 0) - 1
                || item.rect.right > Math.min(box.right, viewportWidth) + 1));
    };

    const findings = [];
    const signatures = new Set();
    for (const [container, rows] of grouped.entries()) {
        for (const row of rows) {
            const items = [...row].sort((a, b) => a.rect.left - b.rect.left);
            const heights = items.filter((item) => item.box || item.iconOnly).map((item) => item.height);
            const styled = items.filter((item) => !item.iconOnly);
            const boxed = styled.filter((item) => item.box);
            const problems = [];
            if (spills(container, items)) problems.push('overflow');
            if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 2) problems.push('height');
            if (boxed.length > 1 && new Set(boxed.map((item) => item.radius)).size > 1) problems.push('border-radius');
            if (styled.length > 1 && new Set(styled.map((item) => item.fontSize)).size > 1) problems.push('font-size');
            if (problems.length === 0) continue;
            const signature = `${problems.join(',')}|${items.map((item) => item.desc).join('|')}`;
            if (signatures.has(signature)) continue;
            signatures.add(signature);
            findings.push({
                problems,
                controls: items.map((item) => ({
                    el: item.desc,
                    height: Number(item.height.toFixed(2)),
                    borderRadius: item.radius,
                    fontSize: item.fontSize,
                    iconOnly: item.iconOnly,
                    box: item.box,
                })),
            });
        }
    }
    return findings;
}

/** The root font size the app computes for a native font scale. */
export const BASE_ROOT_FONT_PX = 16;
export function expectedRootFontPx(fontScale) {
    return fontScale ? BASE_ROOT_FONT_PX * fontScale : null;
}

/**
 * Large text goes in through the app's own font-scale path, the one iOS and
 * Android use, never by writing the root style from the harness: an init
 * script runs before the document has a root element, so a root style set
 * there never applied and the large-text venue measured at 100 percent.
 *
 * Cold start: every document starts with the native bootstrap global the app
 * reads on load (what the iOS shell injects). Live: applyFontScale sends the
 * native font-scale event once the app is listening.
 */
export function installFontScale(page, fontScale) {
    if (!fontScale) return Promise.resolve();
    return page.addInitScript((scale) => {
        window.__xchainNativeFontScale = scale;
    }, fontScale);
}

/** Sends the native font-scale event and waits until the root size follows it. */
export async function applyFontScale(page, fontScale) {
    if (!fontScale) return;
    await page.evaluate((scale) => {
        window.dispatchEvent(new CustomEvent('xchain:native-font-scale', { detail: { fontScale: scale } }));
    }, fontScale);
    await page.waitForFunction(
        (px) => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - px) <= 0.5,
        expectedRootFontPx(fontScale),
        { timeout: 10_000 },
    );
}

/** The root font size failure for one measured screen, or null. */
export function rootFontFailure({ label, rootFontPx, expectedRootFontPx: expected }) {
    if (expected == null) return null;
    if (typeof rootFontPx === 'number' && Math.abs(rootFontPx - expected) <= 0.5) return null;
    const actual = typeof rootFontPx === 'number' ? `${rootFontPx}px` : 'unread';
    return `${label}: root font size ${actual}, expected ${expected}px`;
}

/**
 * The gutter every route keeps between its content and the window edge: one
 * 12px gutter at every width, the --xc-page-gutter token.
 */
export const PAGE_GUTTER_PX = 12;

/**
 * The layout keys the page gutter contract owns. The other keys
 * (headerScrolledAway, contentEdge) are open UI debt measured against the
 * rulings allowlist by tests/layout/rulings-gate.spec.js.
 */
export const GUTTER_CONTRACT_KEYS = Object.freeze(['rootFont', 'gutter', 'topGap']);

/**
 * Every layout finding of a completed sweep, keyed:
 *   rootFont            the screen lost the text size it was measured at
 *   gutter              content, header or first block off the page gutter
 *   topGap              form and list top gaps differ inside one shell
 *   headerScrolledAway  the app header or navigation left the viewport when
 *                       the page scrolled (measured with `rulings: true`)
 *   contentEdge         a list, card or table stops short of the usable
 *                       content width, so it does not reach the scrollbar
 * Each finding is { key, screen, detail }; `screen` is null for a finding
 * about the whole sweep.
 */
export function layoutSweepFindings(screens) {
    const findings = [];
    const add = (key, screen, detail) => findings.push({ key, screen, detail });
    // The sidebar layout sets its own top gap per tier, so form and list gaps
    // are only comparable inside one shell: onboarding screens sit outside it.
    const gapsByShell = new Map();
    const close = (actual, expected) => Math.abs(actual - expected) <= 1;
    for (const screen of screens) {
        const rootFailure = rootFontFailure(screen);
        if (rootFailure) add('rootFont', screen.label, rootFailure);
    }
    for (const { label, layout, vw } of screens) {
        if (!layout) {
            add('gutter', label, `${label}: missing #xc-main layout measurement`);
            continue;
        }
        const gutter = PAGE_GUTTER_PX;
        const { first } = layout;
        if (!close(layout.contentLeft, gutter)) {
            add('gutter', label, `${label}: content left ${layout.contentLeft}px, expected ${gutter}px`);
        }
        if (layout.contentRightGap + 1 < gutter) {
            add('gutter', label, `${label}: content right gap ${layout.contentRightGap}px, expected at least ${gutter}px`);
        }
        if (layout.headerLeft !== null && !close(layout.headerLeft, gutter)) {
            add('gutter', label, `${label}: header left ${layout.headerLeft}px, expected ${gutter}px`);
        }
        if (!first) {
            add('gutter', label, `${label}: missing first content block`);
            continue;
        }
        // Wide forms intentionally centre their card inside the guttered
        // content lane, as wide onboarding steps centre their column. Every
        // other first block starts on the lane edge.
        const centred = vw >= 600 && first.left > gutter * 2 && close(first.left, first.rightGap);
        if ((first.kind !== 'form' || vw < 600) && !centred && !close(first.left, gutter)) {
            add('gutter', label, `${label}: first content left ${first.left}px, expected ${gutter}px`);
        }
        if (first.rightGap + 1 < gutter) {
            add('gutter', label, `${label}: first content right gap ${first.rightGap}px, expected at least ${gutter}px`);
        }
        const shell = layout.tier ?? 'none';
        if (!gapsByShell.has(shell)) gapsByShell.set(shell, { form: new Set(), list: new Set() });
        gapsByShell.get(shell)[first.kind].add(first.topGap);
    }
    for (const topGaps of gapsByShell.values()) {
        if (!topGaps.form.size || !topGaps.list.size) continue;
        const forms = [...topGaps.form].sort((a, b) => a - b);
        const lists = [...topGaps.list].sort((a, b) => a - b);
        if (forms.length !== lists.length || forms.some((gap, i) => !close(gap, lists[i]))) {
            add('topGap', null, `form top gaps [${forms.join(', ')}] do not match list top gaps [${lists.join(', ')}]`);
        }
    }
    for (const { label, headerScrolledAway = [], narrow = [] } of screens) {
        for (const item of headerScrolledAway) {
            add('headerScrolledAway', label, `${label}: ${item.el} scrolled out of view (top ${item.top}px, bottom ${item.bottom}px)`);
        }
        for (const item of narrow) {
            add('contentEdge', label, `${label}: ${item.el} is ${item.short}px short of the ${item.usable}px content width`);
        }
    }
    return findings;
}

/** Measure one screen and append the layout sweep's shared JSONL record shape. */
export async function recordMeasuredScreen(page, {
    venue, outDir, n, label, shot, contrast = false, expectedRootPx = null, onScreen = null, onResult = null,
    rulings = false, screenshots = true,
}) {
    let result;
    try {
        result = await page.evaluate(measureInPage, { contrast });
    } catch (err) {
        result = { error: String(err?.message || err) };
    }
    // Every screen records the root size it was measured at, so a venue
    // that lost its text size fails by name instead of measuring 100%.
    try {
        result.rootFontPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    } catch { /* reported as a root font failure below */ }
    if (expectedRootPx != null) result.expectedRootFontPx = expectedRootPx;
    if (rulings) {
        try {
            result.rulings = await page.evaluate(measureRulings);
            result.headerScrolledAway = await page.evaluate(measureHeaderPinned);
        } catch (err) {
            result.rulingsError = String(err?.message || err);
        }
    }
    // Extra per-screen audits hook in here; a failure in one is reported on
    // the screen's line, never thrown into the walk.
    if (onScreen) {
        try { result = { ...result, ...(await onScreen(page, label)) }; } catch (err) { result = { ...result, onScreenError: String(err?.message || err) }; }
    }
    if (screenshots) {
        try {
            await page.screenshot({ path: join(outDir, shot) });
        } catch { /* a screenshot failure is not a finding */ }
    }
    appendFileSync(join(outDir, 'results.jsonl'), `${JSON.stringify({ venue, n, label, shot, ...result })}\n`);
    if (onResult) await onResult({ label, ...result });
    return result;
}

/**
 * Returns the layout failures of a completed sweep as one line each.
 * `keys` limits them to some layoutSweepFindings keys; by default every key.
 */
export function layoutSweepFailures(screens, { keys = null } = {}) {
    return layoutSweepFindings(screens)
        .filter((finding) => !keys || keys.includes(finding.key))
        .map((finding) => finding.detail);
}

/**
 * Runs inside the page. The app header and the primary navigation stay on
 * screen while the page scrolls: drives every vertical scroller that holds
 * the page content to its end, reads where each header and navigation bar
 * outside the content sits, and puts every scroller back. Returns the bars
 * that were in view before the scroll and left it after.
 */
export function measureHeaderPinned() {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const scrollable = (v) => v === 'auto' || v === 'scroll' || v === 'overlay';
    const desc = (el) => {
        let s = el.tagName.toLowerCase();
        const cls = [...el.classList].slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
        const label = el.getAttribute('aria-label');
        if (label) s += ` "${label.slice(0, 40)}"`;
        return s;
    };
    const inView = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width >= 1.5 && r.height >= 1.5 && r.top >= -1 && r.bottom <= vh + 1 && r.left < vw && r.right > 0;
    };
    const main = document.getElementById('xc-main');
    const scrollers = [];
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 1) scrollers.push(se);
    for (let a = main; a && a !== document.documentElement && a !== document.body; a = a.parentElement) {
        if (scrollable(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight + 1) scrollers.push(a);
    }
    if (scrollers.length === 0) return [];
    const saved = scrollers.map((el) => el.scrollTop);
    const out = [];
    try {
        // The bars in view with the page at its top are the ones that must stay.
        for (const el of scrollers) el.scrollTo({ top: 0, behavior: 'instant' });
        const bars = [...document.querySelectorAll('header, nav')]
            .filter((el) => !(main && main.contains(el)) && !el.closest('[role="dialog"], [role="menu"], [aria-hidden="true"]'))
            .filter((el) => !el.parentElement?.closest('header, nav'))
            .filter(inView);
        for (const el of scrollers) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
        for (const bar of bars) {
            if (inView(bar)) continue;
            const r = bar.getBoundingClientRect();
            if (out.length < 12) out.push({ el: desc(bar), top: Math.round(r.top), bottom: Math.round(r.bottom) });
        }
    } finally {
        scrollers.forEach((el, i) => el.scrollTo({ top: saved[i], behavior: 'instant' }));
    }
    return out;
}

/**
 * A sweep bound to one page, one venue and one output directory.
 * `rulings` also records measureRulings and measureHeaderPinned on every
 * screen; `screenshots: false` skips the per-screen PNG.
 */
export function createSweep(page, {
    venue, outDir, restart: restartPage = () => page.goto('/'), onScreen = null, onResult = null, contrast = false, fontScale,
    rulings = false, screenshots = true,
}) {
    mkdirSync(outDir, { recursive: true });
    const linesPath = join(outDir, 'results.jsonl');
    writeFileSync(linesPath, '');
    const pageReady = installFontScale(page, fontScale);
    const expectedRootPx = expectedRootFontPx(fontScale);
    let n = 0;

    /** Reload the app and, once it is listening, send the font scale again. */
    async function restart() {
        await restartPage();
        if (!fontScale) return;
        await page.getByRole('button', { name: 'Skip' }).or(page.getByRole('button', { name: 'Create new wallet' }))
            .or(unlockedShell(page)).first().waitFor({ state: 'visible', timeout: 60_000 });
        await applyFontScale(page, fontScale);
    }

    async function measure(label) {
        await page.waitForTimeout(450);
        n += 1;
        const slug = `${String(n).padStart(3, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
        return recordMeasuredScreen(page, {
            venue,
            outDir,
            n,
            label,
            shot: `${slug}.png`,
            contrast,
            expectedRootPx,
            onScreen,
            onResult,
            rulings,
            screenshots,
        });
    }

    /** Close anything open and land on Home. */
    async function home() {
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('Escape').catch(() => {});
        try {
            if (await nav(page).count() > 0) {
                await gotoSection(page, 'Home');
                return;
            }
        } catch { /* fall through */ }
        for (let i = 0; i < 6; i += 1) {
            const back = page.getByRole('button', { name: /^Back/ }).first();
            if (await back.count() === 0 || !(await back.isVisible().catch(() => false))) break;
            await back.click().catch(() => {});
            await page.waitForTimeout(200);
        }
    }

    /** The visible, enabled buttons of the current screen's content area. */
    function rowButtons() {
        return page.locator('main button:visible:not([disabled])');
    }

    /**
     * Open each row of a list screen in turn, measure it, and come back.
     * Rows are re-found by their first text line after every return (the
     * same line's nth occurrence, for repeated labels), so a row whose
     * accessible name differs from its text is still visited, and a notice
     * that comes or goes above the list does not shift every row after it.
     * `reopen` brings the list screen back; `rows` finds its rows.
     */
    async function crawlRows(prefix, reopen, rows = rowButtons, skip = null) {
        const firstLines = () => rows().evaluateAll((els) => els.map((e) => (
            (e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim()
        )));
        await reopen();
        const labels = await firstLines();
        let visited = 0;
        for (let i = 0; i < labels.length; i += 1) {
            const label = labels[i];
            if (!label || /^Back/.test(label) || DESTRUCTIVE.test(label) || skip?.test(label)) continue;
            try {
                await reopen();
                const occurrence = labels.slice(0, i).filter((other) => other === label).length;
                const now = await firstLines();
                const index = now.findIndex((other, j) => other === label
                    && now.slice(0, j).filter((prev) => prev === label).length === occurrence);
                if (index < 0) continue; // the row is gone from the list
                const row = rows().nth(index);
                await row.click({ timeout: 5_000 });
                await measure(`${prefix}: ${label}`);
                visited += 1;
            } catch (err) {
                appendFileSync(linesPath, `${JSON.stringify({ venue, label: `${prefix}: ${label}`, skipped: String(err?.message || err).slice(0, 120) })}\n`);
            }
        }
        if (visited === 0) {
            appendFileSync(linesPath, `${JSON.stringify({ venue, label: prefix, skipped: `no rows visited out of ${labels.length} found` })}\n`);
        }
        await home();
    }

    /**
     * The onboarding walk. `demo` stops short of persisting a wallet and
     * enters demo mode instead, for venues where creating a real vault
     * would touch the OS keychain (the desktop app).
     */
    async function onboarding({ demo = false } = {}) {
        await pageReady;
        await restart();
        await page.getByRole('button', { name: 'Skip' }).or(page.getByRole('button', { name: 'Create new wallet' }))
            .first().waitFor({ state: 'visible', timeout: 60_000 });
        await measure('onboarding: intro carousel');
        await dismissIntroCarousel(page);
        await measure('onboarding: welcome');
        for (const name of ['Import wallet', 'From FreeWallet', 'Pair a watcher or signer']) {
            const btn = page.getByRole('button', { name });
            if (await btn.count() === 0) continue;
            await btn.click();
            await measure(`onboarding: ${name}`);
            await restart();
            await dismissIntroCarousel(page);
        }
        // The create walk, measured at each stage.
        await page.getByRole('button', { name: 'Create new wallet' }).click();
        await measure('create: password');
        await page.getByLabel('Password', { exact: true }).fill('layoutsweep1234');
        await page.getByLabel(/^Confirm( password)?$/).fill('layoutsweep1234');
        await page.getByRole('button', { name: 'Next' }).click();
        await page.getByLabel(/written down|saved my recovery phrase/i).waitFor({ timeout: 60_000 });
        // readRecoveryPhrase asserts the stage opens concealed, then reveals it.
        const words = await readRecoveryPhrase(page);
        await measure('create: recovery phrase');
        await page.getByLabel(/written down|saved my recovery phrase/i).check();
        await page.getByRole('button', { name: 'Verify recovery phrase' }).click();
        await measure('create: verify phrase');
        await completeRecoveryPhraseChallenge(page, words);
        if (demo) {
            await restart();
            await dismissIntroCarousel(page);
            await page.getByRole('button', { name: 'Try in demo mode' }).click();
            await unlockedShell(page).waitFor({ state: 'visible', timeout: 120_000 });
            await applyFontScale(page, fontScale);
            return;
        }
        await page.getByRole('button', { name: 'Create wallet' }).click();
        const notice = page.getByRole('heading', { name: 'Automatic Donation System', exact: true });
        await notice.or(unlockedShell(page)).first().waitFor({ state: 'visible', timeout: 240_000 });
        if (await notice.isVisible()) {
            await measure('create: donation notice');
            await page.getByRole('button', { name: 'Continue', exact: true }).click();
        }
        await unlockedShell(page).waitFor({ state: 'visible', timeout: 240_000 });
        await applyFontScale(page, fontScale);
    }

    async function unlocked() {
        await measure('home: coins');
        for (const tab of ['Tokens', 'NFTs', 'DeFi', 'Activity']) {
            const t = page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab, exact: true })).first();
            if (await t.count() === 0) continue;
            await t.click().catch(() => {});
            await measure(`home: ${tab}`);
        }
        await home();

        // Every screen the primary navigation opens (the sidebar on a wide
        // window, the bottom bar on a narrow one), so each top-level screen
        // is measured as the navigation shows it.
        const navButtons = () => nav(page).locator('button:visible:not([disabled])');
        if (await nav(page).count() > 0) {
            const labelsNow = () => navButtons().evaluateAll((els) => els.map((e) => (
                (e.getAttribute('title') || e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0].trim()
            )));
            const navLabels = (await labelsNow())
                .filter((label) => label && !/^(search|more|open command palette)$/i.test(label) && !DESTRUCTIVE.test(label));
            for (const label of [...new Set(navLabels)]) {
                try {
                    await home();
                    const index = (await labelsNow()).indexOf(label);
                    if (index < 0) continue;
                    await navButtons().nth(index).click({ timeout: 5_000 });
                    await measure(`nav: ${label}`);
                } catch (err) {
                    appendFileSync(linesPath, `${JSON.stringify({ venue, label: `nav: ${label}`, skipped: String(err?.message || err).slice(0, 120) })}\n`);
                }
            }
            await home();
        }

        // Header popovers.
        for (const name of ['Settings', 'Scan and addresses', 'XChain platform sites']) {
            const b = page.getByRole('button', { name, exact: true }).first();
            if (await b.count() === 0 || !(await b.isVisible())) continue;
            await b.click();
            await measure(`header: ${name} popover`);
            await page.keyboard.press('Escape');
            if (await b.getAttribute('aria-expanded') === 'true') await b.click().catch(() => {});
        }

        // Every destination the command palette offers. The desktop app has
        // no header button for it; there the keyboard shortcut opens it.
        const paletteButton = page.getByRole('button', { name: 'Open command palette' }).first();
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        const openPalette = async () => {
            if (await paletteButton.count() > 0 && await paletteButton.isVisible().catch(() => false)) {
                await paletteButton.click();
            } else {
                await page.keyboard.press('ControlOrMeta+k');
            }
            await palette.waitFor({ state: 'visible', timeout: 10_000 });
        };
        let destinations = [];
        if (await openPalette().then(() => true, () => false)) {
            await measure('palette: open');
            destinations = await palette.getByRole('option').evaluateAll((els) => els
                .map((e) => (e.querySelector('[class*="title"], [class*="label"]')?.textContent || e.textContent || '').trim()));
            destinations = [...new Set(destinations.filter((x) => x && !/^\d/.test(x)))];
            await page.keyboard.press('Escape');
        }
        for (const dest of destinations) {
            if (DESTRUCTIVE.test(dest)) continue;
            try {
                await openPalette();
                await palette.getByRole('combobox').fill(dest);
                const option = palette.getByRole('option').filter({ hasText: dest }).first();
                await option.click({ timeout: 5_000 });
                await measure(`palette: ${dest}`);
            } catch (err) {
                appendFileSync(linesPath, `${JSON.stringify({ venue, label: `palette: ${dest}`, skipped: String(err?.message || err).slice(0, 120) })}\n`);
            }
            await home();
        }

        // The header menu and each of its rows. Its links open the platform
        // sites in a new window and Open in new window opens another wallet
        // window; neither is a wallet screen, so neither is walked.
        const menu = page.getByRole('button', { name: 'Open menu' }).first();
        if (await menu.count() > 0 && await menu.isVisible()) {
            const menuPanel = page.getByRole('menu', { name: 'Header actions' });
            await home();
            await menu.click();
            await measure('menu: list');
            // Reopened fresh for every row: the Settings row opens a flyout
            // over the menu that would take the next row's click.
            await crawlRows('menu', async () => {
                await home();
                await menu.click();
                await menuPanel.waitFor({ state: 'visible', timeout: 5_000 });
            }, () => menuPanel.locator('button[role="menuitem"]:visible:not([disabled])'), /new window/i);
        }

        // Settings and every section in it.
        await home();
        await openSettings(page);
        await measure('settings: list');
        await crawlRows('settings', async () => {
            const back = page.getByRole('button', { name: 'Back to settings' });
            if (await back.count() > 0 && await back.isVisible().catch(() => false)) {
                await back.click();
                await page.waitForTimeout(250);
                return;
            }
            if (await page.getByRole('searchbox', { name: 'Search settings' }).isVisible().catch(() => false)) return;
            await home();
            await openSettings(page);
        });

        // The bottom navigation's More sheet, where it exists.
        const more = nav(page).getByRole('button', { name: 'More', exact: true });
        if (await more.count() > 0) {
            await more.click();
            await measure('nav: More sheet');
            await page.keyboard.press('Escape');
        }
    }

    return { measure, home, onboarding, unlocked };
}

/**
 * Runs inside the page. The operator's layout rulings that the geometry
 * above does not measure: the app header on one row, fields that draw a
 * border, no Paste button and Max inside its field, no dotted or dashed borders,
 * every card drawn with the card tokens, notices kept out of headers, no
 * title repeated on one screen, and no Back button beside a sidebar entry
 * for the screen it shows. Findings are for a person to judge.
 */
export function measureRulings() {
    const visible = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0
            && r.width >= 1.5 && r.height >= 1.5;
    };
    const desc = (el) => {
        let s = el.tagName.toLowerCase();
        const cls = [...el.classList].slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
        const label = el.getAttribute('aria-label')
            || (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        if (label) s += ` "${label}"`;
        return s;
    };
    const text = (el) => (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    const out = {
        headerRows: [], borderlessFields: [], fieldButtonsOutside: [], dashedBorders: [],
        offTokenCards: [], noticesInHeader: [], repeatedText: [], backBesideSidebar: [], noticePlacement: [],
    };
    const cap = (list, item) => { if (list.length < 12) list.push(item); };

    // Header rows: the controls of each visible header share one row. A header
    // with nothing to press (a form's logo, title and tagline stacked) is a
    // title block, not a bar, so it has no row to keep.
    const CONTROL = 'button, a[href], img, svg, h1, h2, input, select, [role="button"]';
    const PRESSABLE = 'button, a[href], input, select, [role="button"]';
    for (const header of document.querySelectorAll('header')) {
        if (!visible(header)) continue;
        if (![...header.querySelectorAll(PRESSABLE)].some(visible)) continue;
        const items = [...header.querySelectorAll(CONTROL)]
            .filter((el) => visible(el) && !el.parentElement?.closest(CONTROL));
        const rects = items.map((el) => ({ el, r: el.getBoundingClientRect() }));
        let rows = 1;
        const sorted = rects.sort((a, b) => a.r.top - b.r.top);
        let rowBottom = sorted[0]?.r.bottom ?? 0;
        for (const { r } of sorted.slice(1)) {
            if (r.top >= rowBottom - 1) { rows += 1; rowBottom = r.bottom; } else rowBottom = Math.max(rowBottom, r.bottom);
        }
        if (rows > 1) cap(out.headerRows, { header: desc(header).slice(0, 60), rows, h: Math.round(header.getBoundingClientRect().height) });
    }

    // Fields draw a border (on themselves or on the wrapper that frames them).
    const edged = (el) => {
        const cs = getComputedStyle(el);
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        return sides.some((s) => parseFloat(cs[`border${s}Width`]) >= 1 && cs[`border${s}Style`] !== 'none')
            || (cs.boxShadow && cs.boxShadow !== 'none');
    };
    const fields = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), textarea, select')]
        .filter(visible);
    const frameOf = (field) => {
        if (edged(field)) return field;
        const fr = field.getBoundingClientRect();
        for (let a = field.parentElement, i = 0; a && i < 3; a = a.parentElement, i += 1) {
            const ar = a.getBoundingClientRect();
            // A wrapper that frames the field hugs it, not a whole card.
            if (ar.height > fr.height + 24) break;
            if (edged(a)) return a;
        }
        return null;
    };
    for (const field of fields) {
        if (field.closest('[role="dialog"][aria-label="Command palette"]')) continue;
        if (!frameOf(field)) cap(out.borderlessFields, desc(field));
    }

    // No Paste button anywhere (users paste with the native menu and
    // shortcuts); Max sits inside the field it acts on.
    for (const btn of document.querySelectorAll('button')) {
        if (!visible(btn)) continue;
        const name = text(btn);
        if (/^paste\b/i.test(name)) { cap(out.fieldButtonsOutside, { button: name, paste: true }); continue; }
        if (!/^max\b/i.test(name)) continue;
        let field = null;
        for (let a = btn.parentElement, i = 0; a && i < 4 && !field; a = a.parentElement, i += 1) {
            field = [...a.querySelectorAll('input, textarea')].find(visible) || null;
        }
        if (!field) { cap(out.fieldButtonsOutside, { button: name, field: null }); continue; }
        const frame = frameOf(field) || field;
        const fr = frame.getBoundingClientRect();
        const br = btn.getBoundingClientRect();
        const inside = br.left >= fr.left - 1 && br.right <= fr.right + 1 && br.top >= fr.top - 1 && br.bottom <= fr.bottom + 1;
        if (!inside) cap(out.fieldButtonsOutside, { button: name, field: desc(field) });
    }

    // Dotted or dashed borders anywhere, and boxes drawn off the card tokens.
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;border:var(--xc-card-border);border-radius:var(--xc-card-radius)';
    document.body.appendChild(probe);
    const tok = getComputedStyle(probe);
    const token = { w: tok.borderTopWidth, c: tok.borderTopColor, r: tok.borderTopLeftRadius };
    probe.remove();
    void root;
    const NOT_CARD = 'button, input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="dialog"], [role="menu"], [role="listbox"], header, nav, img, svg';
    const NOTICE = '[role="status"], [role="alert"], [data-variant]';
    for (const el of document.querySelectorAll('body *')) {
        if (!visible(el)) continue;
        // U15 governs notice placement. A StatusMessage keeps data-variant when
        // a static page notice deliberately has no live-region role.
        if (el.closest(NOTICE)) continue;
        const cs = getComputedStyle(el);
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        const styled = sides.filter((s) => parseFloat(cs[`border${s}Width`]) > 0);
        if (styled.some((s) => /dotted|dashed/.test(cs[`border${s}Style`]))) {
            cap(out.dashedBorders, { el: desc(el), style: cs.borderTopStyle });
        }
        if (styled.length !== 4 || el.matches(NOT_CARD) || el.closest('header, nav, [role="dialog"], [role="menu"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 44 || r.width < 120) continue;
        if (parseFloat(cs.borderTopLeftRadius) === 0) continue;
        // A card is a rounded box with a solid edge all round and content inside.
        if (el.querySelector('input, textarea, select') && r.height < 70) continue; // a field frame
        const off = cs.borderTopWidth !== token.w || cs.borderTopStyle !== 'solid'
            || cs.borderTopColor !== token.c || cs.borderTopLeftRadius !== token.r;
        if (off) {
            cap(out.offTokenCards, {
                el: desc(el), border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, radius: cs.borderTopLeftRadius,
                token: `${token.w} solid ${token.c} / ${token.r}`,
            });
        }
    }

    // Notices are page content, never in a header.
    for (const el of document.querySelectorAll('[role="alert"], [role="status"], [class*="notice" i], [class*="banner" i]')) {
        if (!visible(el) || !text(el)) continue;
        if (el.closest('header')) cap(out.noticesInHeader, desc(el));
    }

    // One title and one copy of each help line per screen. An open modal is
    // the screen: the page behind it is inert, so its title is not read as a
    // repeat of a row in the modal.
    const seen = new Map();
    const modal = [...document.querySelectorAll('[aria-modal="true"]')].filter(visible).pop();
    for (const el of (modal || document).querySelectorAll('h1, h2, h3, h4, p, [class*="title" i], [class*="help" i], [class*="hint" i]')) {
        if (!visible(el) || el.closest('[aria-hidden="true"], nav, [role="dialog"][aria-label="Command palette"]')) continue;
        if (el.querySelector('h1, h2, h3, h4, p')) continue;
        const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
        if (t.length < 4) continue;
        const key = t.toLowerCase();
        if (!seen.has(key)) seen.set(key, []);
        if (!seen.get(key).includes(el)) seen.get(key).push(el);
    }
    for (const [t, els] of seen) {
        if (els.length > 1 && !els.some((a, i) => els.some((b, j) => i !== j && (a.contains(b) || b.contains(a))))) {
            cap(out.repeatedText, { text: t.slice(0, 60), count: els.length, els: els.slice(0, 3).map(desc) });
        }
    }

    // The screen a sidebar entry opens needs no Back while the sidebar shows:
    // flagged when the page title names the entry marked current. A screen
    // below that entry (an order list under DEX) keeps its Back.
    const sidebar = document.querySelector('nav[aria-label="Primary navigation"]');
    if (sidebar && visible(sidebar)) {
        const current = sidebar.querySelector('[aria-current="page"], [aria-current="true"]');
        const back = [...document.querySelectorAll('header button, header a')]
            .find((b) => visible(b) && /^back\b/i.test(text(b)));
        const pageTitle = [...document.querySelectorAll('header h1, header h2')].find(visible);
        const label = current ? (current.innerText || '').trim().split('\n')[0].trim().toLowerCase() : '';
        const titleText = pageTitle ? (pageTitle.innerText || '').trim().toLowerCase() : '';
        if (current && back && label && titleText === label) {
            cap(out.backBesideSidebar, { current: label, back: text(back) });
        }
    }

    // Notices sit first in the page content, at its full width.
    const main = document.getElementById('xc-main');
    if (main) {
        const mr = main.getBoundingClientRect();
        const mcs = getComputedStyle(main);
        const left = mr.left + main.clientLeft + (parseFloat(mcs.paddingLeft) || 0);
        const right = mr.left + main.clientLeft + main.clientWidth - (parseFloat(mcs.paddingRight) || 0);
        const NOTICE = '[data-xc-notice], [role="alert"], [role="status"]';
        const notices = [...main.querySelectorAll(NOTICE)]
            .filter((el) => visible(el) && text(el).length > 0 && !el.parentElement.closest(NOTICE));
        for (const el of notices) {
            if (el.closest('form, [role="dialog"], [role="group"]')) continue; // a form's own status line
            // A status that announces nothing is a label of the data beside
            // it ("Updated just now" under a balance), not a notice.
            if (el.matches('[role="status"][aria-live="off"]')) continue;
            const r = el.getBoundingClientRect();
            const contentAbove = [...main.querySelectorAll('h2, h3, p, li, button, input, table')]
                .some((other) => visible(other) && !el.contains(other) && !other.closest(NOTICE)
                    && other.getBoundingClientRect().bottom <= r.top + 1);
            const narrow = right - left - r.width > 2;
            // An empty state stands where its list would be, below the
            // page's own controls; U15 asks of it only that it fill the
            // content width, so it is measured for width, not for place.
            const emptyState = el.matches('[data-xc-empty-state]');
            if ((contentAbove && !emptyState) || narrow) {
                cap(out.noticePlacement, { el: desc(el), contentAbove, width: Math.round(r.width), content: Math.round(right - left) });
            }
        }
    }

    for (const k of Object.keys(out)) if (out[k].length === 0) delete out[k];
    return out;
}
