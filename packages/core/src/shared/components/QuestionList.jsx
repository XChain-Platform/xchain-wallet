// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { outcomeSurfaceColor } from './outcomeDetail/outcomeColors.js';
import styles from './QuestionList.module.css';

/** The one framed question list used by prediction markets and governance. */
export function QuestionList({ label, children, empty = null, split = false }) {
    return (
        <div className={styles.panel} data-question-list-panel="">
            {children ? (
                <ul className={styles.list} role="list" aria-label={label} data-xc-split-list={split ? '' : undefined}>
                    {children}
                </ul>
            ) : empty}
        </div>
    );
}

/**
 * A question, its state, the leading answer and one compact share bar per
 * answer. Prediction markets and governance adapt their own wire rows to this
 * display shape, keeping money and vote wording outside the shared component.
 */
export function QuestionListRow({
    question,
    status,
    timing = null,
    badge = null,
    answers = [],
    sharesKnown = false,
    footer = null,
    onOpen,
    selected = false,
    className = '',
    ...rest
}) {
    const questionId = useId();
    const detailId = useId();
    const known = answers.filter((answer) => Number.isFinite(answer.percent));
    const leading = sharesKnown && known.length
        ? known.reduce((best, answer) => (answer.percent > best.percent ? answer : best), known[0])
        : null;
    return (
        <button
            {...rest}
            type="button"
            className={`${styles.row}${className ? ` ${className}` : ''}`}
            onClick={onOpen}
            aria-current={selected ? 'true' : undefined}
            aria-labelledby={questionId}
            aria-describedby={detailId}
            data-question-list-row=""
        >
            <span className={styles.head}>
                <span id={questionId} className={styles.question}>{question}</span>
                <span className={styles.chevron} aria-hidden="true"><Icon.ForwardIcon /></span>
            </span>
            <span id={detailId} className={styles.detail}>
                <span className={styles.meta}>
                    {status ? <span className={styles.status}>{status}</span> : null}
                    {timing ? <span className={styles.timing}>{timing}</span> : null}
                    {badge ? <span className={styles.badge}>{badge}</span> : null}
                </span>
                {leading ? (
                    <span className={styles.leading}>
                        <span>Leading</span>
                        <strong>{leading.label}</strong>
                        <strong>{leading.percent}%</strong>
                    </span>
                ) : null}
                {answers.length ? (
                    <span className={styles.answers} aria-label="Answer shares">
                        {answers.map((answer, index) => {
                            const percent = Number.isFinite(answer.percent)
                                ? Math.max(0, Math.min(100, answer.percent))
                                : null;
                            return (
                                <span className={styles.answer} key={answer.key ?? index}>
                                    <span className={styles.answerLine}>
                                        <span className={styles.answerLabel}>{answer.label}</span>
                                        {sharesKnown && percent !== null ? <strong>{percent}%</strong> : null}
                                    </span>
                                    <span className={styles.track} aria-hidden="true">
                                        <span
                                            className={styles.fill}
                                            style={{ width: `${sharesKnown && percent !== null ? percent : 0}%`, background: outcomeSurfaceColor(index) }}
                                        />
                                    </span>
                                </span>
                            );
                        })}
                    </span>
                ) : null}
                {footer ? <span className={styles.footer}>{footer}</span> : null}
            </span>
        </button>
    );
}

