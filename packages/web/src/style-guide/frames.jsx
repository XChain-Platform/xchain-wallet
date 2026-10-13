// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Width frames for the style guide. The wallet's layout rules are viewport
// media queries, which a 360px <div> on a 1280px page never triggers, so
// every example renders into an <iframe>: its own viewport, same React tree.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** The three platforms the guide previews, by the width their viewport gets. */
export const VIEWS = {
    mobile: { id: 'mobile', label: 'Mobile', width: 360, note: 'phone' },
    extension: { id: 'extension', label: 'Extension', width: 400, note: 'browser-extension popup' },
    desktop: { id: 'desktop', label: 'Desktop', width: 1024, note: 'desktop window' },
};
export const DEFAULT_VIEW = 'desktop';

/** The view named by `?view=` in the page URL, or the default. */
export function readViewFromUrl(search = window.location.search) {
    const v = new URLSearchParams(search).get('view');
    return v && VIEWS[v] ? v : DEFAULT_VIEW;
}

/** Records the view in the URL without a reload, so a copied link opens it. */
export function writeViewToUrl(view) {
    const url = new URL(window.location.href);
    if (view === DEFAULT_VIEW) url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    window.history.replaceState(window.history.state, '', url);
}

export const ViewContext = createContext(DEFAULT_VIEW);
export const useView = () => useContext(ViewContext);

const FRAME_DOC = '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>';
const CLONE_ATTR = 'data-sg-clone';

// Copies every stylesheet in the guide's <head> into the frame. Vite adds a
// <style> per CSS module as modules load, and rewrites them on hot reload,
// so the copy is redone whenever the head changes.
function syncStyles(doc) {
    for (const node of [...doc.head.querySelectorAll(`[${CLONE_ATTR}]`)]) node.remove();
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
        const clone = node.cloneNode(true);
        clone.setAttribute(CLONE_ATTR, '');
        doc.head.appendChild(clone);
    }
}

// Focus moves in a frame scroll the guide to that frame (a dialog that
// autofocuses its button would yank the page on load). Frames never do.
function stopFocusScroll(win) {
    const proto = win.HTMLElement.prototype;
    const focus = proto.focus;
    proto.focus = function focusWithoutScroll(options) {
        return focus.call(this, { ...(options || {}), preventScroll: true });
    };
}

/**
 * One iframe of a fixed CSS width whose content is a React portal, so the
 * example keeps the guide's context and state while every media query inside
 * it sees `width` as the viewport. The frame grows to fit its content.
 *
 * @param {object} props
 * @param {number} props.width                   viewport width in CSS px
 * @param {number} [props.minHeight]             floor for content that is all overlay (a dialog)
 * @param {boolean} [props.padded]               inset the content 12px, for examples that are not a whole Screen
 * @param {string} props.title                   accessible name of the frame
 * @param {import('react').ReactNode} props.children
 */
export function ViewportFrame({ width, minHeight = 0, padded = true, title, children }) {
    const ref = useRef(/** @type {HTMLIFrameElement | null} */ (null));
    const [body, setBody] = useState(/** @type {HTMLElement | null} */ (null));
    const [height, setHeight] = useState(Math.max(minHeight, 120));

    useEffect(() => {
        const iframe = ref.current;
        if (!iframe) return undefined;
        let observer = null;
        let resize = null;
        let frameId = 0;
        const setup = () => {
            const doc = iframe.contentDocument;
            if (!doc || doc.URL !== 'about:srcdoc' || !doc.body || doc.body.dataset.sgReady) return;
            doc.body.dataset.sgReady = '1';
            stopFocusScroll(iframe.contentWindow);
            syncStyles(doc);
            // A Screen sizes itself to the viewport; in a frame it sizes to
            // its content instead, or the frame and the Screen chase each other.
            doc.documentElement.style.setProperty('--xc-screen-h', 'auto');
            doc.documentElement.style.overflow = 'hidden';
            Object.assign(doc.body.style, {
                margin: '0',
                // flow-root keeps a child's margins inside the body, so they count in its height.
                display: 'flow-root',
                padding: padded ? '12px' : '0',
                lineHeight: 'normal',
                fontSize: 'var(--xc-text-md)',
            });
            observer = new MutationObserver(() => {
                cancelAnimationFrame(frameId);
                frameId = requestAnimationFrame(() => syncStyles(doc));
            });
            observer.observe(document.head, { childList: true, subtree: true, characterData: true });
            const measure = () => setHeight(Math.max(minHeight, Math.ceil(doc.body.getBoundingClientRect().height)));
            resize = new iframe.contentWindow.ResizeObserver(measure);
            resize.observe(doc.body);
            measure();
            setBody(doc.body);
        };
        iframe.addEventListener('load', setup);
        // The initial about:blank document is also "complete"; only the srcdoc one counts.
        const current = iframe.contentDocument;
        if (current?.URL === 'about:srcdoc' && current.readyState === 'complete') setup();
        return () => {
            iframe.removeEventListener('load', setup);
            observer?.disconnect();
            resize?.disconnect();
            cancelAnimationFrame(frameId);
        };
    }, [minHeight, padded]);

    return (
        <>
            <iframe
                ref={ref}
                className="sg-frame"
                title={title}
                srcDoc={FRAME_DOC}
                sandbox="allow-same-origin"
                referrerPolicy="no-referrer"
                width={width}
                style={{ width: `${width}px`, height: `${height}px` }}
            />
            {body ? createPortal(children, body) : null}
        </>
    );
}

/**
 * A frame at the width of the view picked in the guide's switch, with its
 * width labelled. Every LiveExample renders through this.
 */
export function ViewFrame({ minHeight, padded, title, children }) {
    const view = VIEWS[useView()];
    return (
        <div className="sg-frame-wrap">
            <p className="sg-frame-label">{view.label} · {view.width}px {view.note}</p>
            <div className="sg-frame-scroll">
                <ViewportFrame width={view.width} minHeight={minHeight} padded={padded} title={`${title || 'Example'}, ${view.label} ${view.width}px`}>
                    {children}
                </ViewportFrame>
            </div>
        </div>
    );
}

/**
 * The same example at all three widths side by side, at true size, so the
 * narrow / wide switch of a page template is visible on one screen. The row
 * breaks out of the guide's text column and wraps when the window is too
 * narrow for all three.
 *
 * @param {object} props
 * @param {(view: typeof VIEWS.mobile) => import('react').ReactNode} props.render   the example, given the frame's view
 * @param {number} [props.minHeight]
 * @param {boolean} [props.padded]       default false: template examples are whole Screens
 * @param {string} props.title
 */
export function WidthTriptych({ render, minHeight, padded = false, title }) {
    return (
        <div className="sg-triptych">
            {Object.values(VIEWS).map((view) => (
                <figure key={view.id} className="sg-triptych-cell">
                    <figcaption className="sg-frame-label">{view.label} · {view.width}px {view.note}</figcaption>
                    <ViewportFrame width={view.width} minHeight={minHeight} padded={padded} title={`${title}, ${view.label} ${view.width}px`}>
                        {render(view)}
                    </ViewportFrame>
                </figure>
            ))}
        </div>
    );
}

/** Keeps the selected view in state and in the URL. */
export function useViewState() {
    const [view, setView] = useState(() => readViewFromUrl());
    useLayoutEffect(() => {
        const onPop = () => setView(readViewFromUrl());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    const choose = (next) => {
        setView(next);
        writeViewToUrl(next);
    };
    return [view, choose];
}
