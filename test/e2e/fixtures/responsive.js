// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  responsive-first program: the measuring tape.
//
// Slice 1 gave the shell one set of breakpoints and one nav surface per
// width. It could not prove that the SCREENS inside that shell survive a
// 360px popup, because nothing in the repo measured a rendered layout:
// jsdom performs no layout at all (every box is 0x0 there), and the CSS
// smoke tests can only read source text. A real browser is the only place
// the question "does this row fit in 360px" has an answer.
//
// These helpers are that answer, and they are deliberately blunt: a
// screen passes when nothing on it sticks out past the viewport, and
// fails with the list of elements that did, so a red run names the
// offending node instead of just its screen.

/**
 * Representative widths the wallet must render at, narrowest first.
 *
 * 360 is the load-bearing one: it is the Chrome extension popup and the
 * small-Android floor, and it is the width the item's verify line names.
 * The rest cover one width per layout tier plus the two tier boundaries,
 * where an off-by-one in the shared breakpoints would show up.
 */
export const VIEWPORTS = [
    { name: 'popup 360', width: 360, height: 640, tier: 'compact' },
    { name: 'phone 390', width: 390, height: 844, tier: 'compact' },
    { name: 'compact edge 639', width: 639, height: 900, tier: 'compact' },
    { name: 'rail edge 640', width: 640, height: 900, tier: 'rail' },
    { name: 'tablet 768', width: 768, height: 1024, tier: 'rail' },
    { name: 'full edge 900', width: 900, height: 900, tier: 'full' },
    { name: 'desktop 1280', width: 1280, height: 800, tier: 'full' },
];

/**
 * The subset the full route walk uses: one width per tier.
 *
 * Walking every route at all seven widths costs minutes and re-proves the
 * same thing, because two widths in the same tier lay out identically
 * except for how much slack they have; the narrowest of each tier is the
 * one that fails first. The boundary widths still get exercised by the
 * cheap tier assertions, which is where an off-by-one would show.
 */
export const WALK_VIEWPORTS = VIEWPORTS.filter(
    (vp) => vp.name === 'popup 360' || vp.name === 'tablet 768' || vp.name === 'desktop 1280',
);

/**
 * Elements painted outside the viewport's horizontal bounds.
 *
 * Runs in the page because only the browser knows the laid-out boxes.
 *
 * Deliberate exclusions, each one a false positive we would otherwise
 * chase forever:
 *   - zero-area nodes: hidden, unmounted, or purely structural.
 *   - anything inside an ancestor that scrolls or clips on the inline
 *     axis: a wide `<pre>` in an `overflow-x: auto` box is a designed
 *     affordance, not a leak. Only overflow that reaches the document
 *     counts.
 *   - `aria-hidden` decorations that are visually offset on purpose
 *     (screen-reader clip pattern uses `clip-path`, which still reports
 *     a box).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{tag: string, cls: string, text: string, left: number, right: number}>>}
 */
export function overflowingElements(page) {
    return page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        // Sub-pixel layout rounds; a third of a pixel is not a defect.
        const SLACK = 1;

        const clipsInline = (el) => {
            const s = getComputedStyle(el);
            return s.overflowX === 'auto' || s.overflowX === 'scroll'
                || s.overflowX === 'hidden' || s.overflowX === 'clip';
        };

        const out = [];
        for (const el of document.body.querySelectorAll('*')) {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            if (box.right <= limit + SLACK && box.left >= -SLACK) continue;

            let clipped = false;
            for (let p = el.parentElement; p; p = p.parentElement) {
                if (clipsInline(p)) { clipped = true; break; }
            }
            if (clipped) continue;

            out.push({
                tag: el.tagName.toLowerCase(),
                cls: typeof el.className === 'string' ? el.className : '',
                text: (el.textContent || '').trim().slice(0, 60),
                left: Math.round(box.left),
                right: Math.round(box.right),
            });
        }
        return out;
    });
}

/**
 * Does the document itself scroll sideways?
 *
 * This is the symptom a user feels: the page rubber-bands horizontally
 * and content sits off-screen. `overflowingElements` says which node did
 * it; this says whether it reached the user.
 */
export function documentOverflow(page) {
    return page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
    });
}

/** WCAG 2.2 AA 2.5.8 "Target Size (Minimum)", in CSS px. Mirrors `--xc-tap-min`. */
export const TAP_MIN_PX = 24;

/**
 * Interactive controls whose pointer target is under the floor.
 *
 * What counts as "the target" is the part a user can actually hit, not
 * the painted glyph: a bare checkbox inside a `<label>` is activated by
 * clicking anywhere in that label, so the label is the target. Anything
 * that does not have such a wrapper is measured on its own box.
 *
 * Not covered here on purpose: WCAG's spacing exception (an undersized
 * target passes if no other target comes within a 24px circle of it).
 * The wallet's answer is simpler and stricter - every target meets the
 * floor - because "it passes because nothing is near it" is a property
 * that breaks the next time a control is added beside it.
 */
export function undersizedTargets(page, min = TAP_MIN_PX) {
    return page.evaluate((floor) => {
        const SELECTOR = [
            'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
            'summary', '[role="button"]', '[role="tab"]', '[role="switch"]',
            '[role="checkbox"]', '[role="radio"]', '[role="option"]', '[role="menuitem"]',
        ].join(', ');

        const out = [];
        for (const el of document.querySelectorAll(SELECTOR)) {
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') continue;
            if (el.disabled) continue;

            let box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;

            // A wrapping <label> activates the control, so it IS the target.
            const label = el.closest('label');
            if (label) {
                const lb = label.getBoundingClientRect();
                if (lb.width >= box.width && lb.height >= box.height) box = lb;
            }

            if (box.width >= floor && box.height >= floor) continue;

            out.push({
                tag: el.tagName.toLowerCase(),
                cls: (typeof el.className === 'string' ? el.className : '').trim().slice(0, 60),
                label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
                w: Math.round(box.width),
                h: Math.round(box.height),
            });
        }
        return out;
    }, min);
}

/** Human-readable offender list for an assertion message. */
export function describeOffenders(offenders) {
    return offenders
        .map((o) => `<${o.tag} class="${o.cls}"> [${o.left}..${o.right}] ${JSON.stringify(o.text)}`)
        .join('\n');
}

/** Human-readable list for a target-size failure. */
export function describeTargets(targets) {
    return targets
        .map((t) => `<${t.tag} class="${t.cls}"> ${t.w}x${t.h} ${JSON.stringify(t.label)}`)
        .join('\n');
}

/**
 * The layout tier the shell resolved, read off the attribute
 * `<FullLayoutWithNav>` publishes (slice 1). Null when the shell in front
 * of us has no tiered layout (locked screen, onboarding, MV3 popup).
 */
export function renderedTier(page) {
    return page.evaluate(() => document.querySelector('[data-xc-tier]')?.dataset.xcTier ?? null);
}

/**
 * Cold browser -> unlocked wallet that HAS SOMETHING IN IT (§25.2 demo
 * mode: balances on four chains, tokens with long display names, NFT
 * tiles, history entries, seeded contacts).
 *
 * A freshly created empty wallet is the easiest thing to measure and the
 * least useful: empty screens have no rows to overflow, so they fit every
 * width by having nothing in them. Layout breaks on CONTENT - a 42-char
 * address, a "0.12345678 BTC ≈ $11,728.70" line, a four-up NFT grid - so
 * the width walk runs against the populated wallet.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function enterDemoWallet(page, { dismissIntroCarousel, expect, unlockedShell }) {
    await page.goto('/');
    await dismissIntroCarousel(page);
    await page.getByRole('button', { name: 'Try in demo mode' }).click();
    // Demo entry runs the real create-wallet path (Argon2id included), so
    // it is as slow as onboarding and needs the same budget.
    await expect(unlockedShell(page)).toBeVisible({ timeout: 90_000 });
}
