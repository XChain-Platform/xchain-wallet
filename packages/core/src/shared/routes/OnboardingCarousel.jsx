// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Button, Icon, useReducedMotion } from '@xchain-wallet/core/ui';
import styles from './OnboardingCarousel.module.css';

/**
 * Cluster J FOLLOWUP 3 (§25.2): a multi-step animated explainer carousel
 * shown once to first-time users, before they create or import a wallet.
 * Presentational and shell-agnostic: it renders content only (no
 * `<Screen>` wrapper) so the caller controls the surrounding chrome and
 * the component stays trivial to unit-test in isolation.
 *
 * Motion contract (mirrors `AnimatedQrFrames`): honors reduced motion,
 * whether the OS asks for it or the user did in Settings → Appearance
 * (`useReducedMotion`). When reduced motion is requested the
 * component drops the slide transition AND the optional auto-advance, and
 * renders every frame stacked in a single scrollable column so a user who
 * can't tolerate movement still gets the full explainer without stepping
 * through it. Auto-advance is opt-in (`autoAdvance`) and, when on, stops
 * permanently the moment the user interacts (Next / Back / a dot / Skip)
 * so it never fights a reader who has taken control.
 *
 * `onDone` fires for both "Get started" (finished) and "Skip": the caller
 * only needs to know the explainer has been dismissed so it can persist
 * the seen-flag. The boolean argument (`completed`) lets a caller that
 * cares distinguish the two without forcing every caller to.
 *
 * @param {object} props
 * @param {Array<{id?: string, title: string, body: string, icon?: import('react').ReactNode}>} props.frames
 *        non-empty; one explainer per frame.
 * @param {(completed: boolean) => void} props.onDone  fired when the user finishes or skips.
 * @param {'small' | 'full'} [props.variant]           layout density; defaults to 'small'.
 * @param {boolean} [props.autoAdvance]                auto-advance frames until the user interacts. Default false.
 * @param {number} [props.autoAdvanceMs]               auto-advance cadence in ms. Default 5000.
 */
export function OnboardingCarousel({
    frames,
    onDone,
    variant = 'small',
    autoAdvance = false,
    autoAdvanceMs = 5000,
}) {
    const isFull = variant === 'full';
    const [index, setIndex] = useState(0);
    // Once the user drives the carousel (Next/Back/dot/Skip), auto-advance
    // is retired for the rest of the session. A reader who takes the wheel
    // should never have the slide yanked out from under them.
    const [userDrove, setUserDrove] = useState(false);
    // : the OS media query AND the in-app Settings → Appearance
    // override. The stacked-frames fallback and the auto-advance timer below
    // are both JS decisions, so they have to ask rather than leave it to CSS.
    const reducedMotion = useReducedMotion();
    const liveRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const count = Array.isArray(frames) ? frames.length : 0;
    const atLast = index >= count - 1;

    useEffect(() => {
        // Auto-advance is opt-in and never runs under reduced motion, once
        // the user has interacted, or on the last frame (advancing off the
        // end would loop the explainer, which is worse than stopping).
        if (!autoAdvance || reducedMotion || userDrove || count <= 1 || atLast) return undefined;
        const ms = Math.max(1200, autoAdvanceMs);
        const id = setInterval(() => {
            setIndex((i) => Math.min(i + 1, count - 1));
        }, ms);
        return () => clearInterval(id);
    }, [autoAdvance, reducedMotion, userDrove, count, atLast, autoAdvanceMs]);

    if (!Array.isArray(frames) || frames.length === 0) return null;

    function goTo(next) {
        setUserDrove(true);
        setIndex(Math.max(0, Math.min(next, count - 1)));
    }

    function handleSkip() {
        setUserDrove(true);
        if (typeof onDone === 'function') onDone(false);
    }

    function handleFinish() {
        setUserDrove(true);
        if (typeof onDone === 'function') onDone(true);
    }

    // --- Reduced motion: stack every frame, no stepping, no auto-advance.
    if (reducedMotion) {
        return (
            <div
                className={isFull ? styles.rootFull : styles.rootPopup}
                data-testid="onboarding-carousel"
                data-reduced-motion="true"
            >
                <div className={styles.stack}>
                    {frames.map((frame, i) => (
                        <section key={frame.id || i} className={styles.stackFrame}>
                            {frame.icon ? <div className={styles.frameIcon}>{frame.icon}</div> : null}
                            <h2 className={styles.frameTitle}>{frame.title}</h2>
                            <p className={styles.frameBody}>{frame.body}</p>
                        </section>
                    ))}
                </div>
                <div className={styles.actions}>
                    <Button variant="primary" block onClick={handleFinish} icon={<Icon.CheckIcon />}>
                        Get started
                    </Button>
                </div>
            </div>
        );
    }

    // --- Default: one frame at a time with dots + prev/next + skip.
    const frame = frames[index];
    return (
        <div
            className={isFull ? styles.rootFull : styles.rootPopup}
            data-testid="onboarding-carousel"
            data-reduced-motion="false"
        >
            <div className={styles.skipRow}>
                <button type="button" className={styles.skipBtn} onClick={handleSkip}>
                    Skip
                </button>
            </div>

            <div
                ref={liveRef}
                className={styles.frameViewport}
                aria-live="polite"
                aria-atomic="true"
            >
                {/* `key` on the frame retriggers the entrance animation per step. */}
                <section key={frame.id || index} className={styles.frame}>
                    {frame.icon ? <div className={styles.frameIcon}>{frame.icon}</div> : null}
                    <h2 className={styles.frameTitle}>{frame.title}</h2>
                    <p className={styles.frameBody}>{frame.body}</p>
                </section>
            </div>

            <div
                className={styles.dots}
                role="tablist"
                aria-label={`Step ${index + 1} of ${count}`}
            >
                {frames.map((f, i) => (
                    <button
                        key={f.id || i}
                        type="button"
                        role="tab"
                        aria-selected={i === index}
                        aria-current={i === index ? 'step' : undefined}
                        aria-label={`Go to step ${i + 1} of ${count}`}
                        className={i === index ? styles.dotActive : styles.dot}
                        onClick={() => goTo(i)}
                    />
                ))}
            </div>

            <div className={styles.nav}>
                <Button
                    variant="ghost"
                    onClick={() => goTo(index - 1)}
                    disabled={index === 0}
                    icon={<Icon.BackIcon />}
                >
                    Back
                </Button>
                {atLast ? (
                    <Button variant="primary" onClick={handleFinish} icon={<Icon.CheckIcon />}>
                        Get started
                    </Button>
                ) : (
                    <Button variant="primary" onClick={() => goTo(index + 1)} icon={null}>
                        Next
                    </Button>
                )}
            </div>
        </div>
    );
}
