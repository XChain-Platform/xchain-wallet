// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId } from 'react';
import { SectionHeader } from './SectionHeader.jsx';
// Shares FormPage's stylesheet: whether a section draws a card depends on
// the form around it, and only one module can express that pairing.
import styles from './FormPage.module.css';

/**
 * One titled part of a long form. Inside `<FormPage sectioned>` it is a
 * card of its own when the viewport is wide and a bare block divided from
 * the previous one by its heading when narrow. Inside a plain FormPage it
 * is always the bare, heading-divided block, so a card never nests in a card.
 *
 * The section is a named region (aria-labelledby its heading), so a screen
 * reader lists it among the page's landmarks.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description]   one muted line under the title
 * @param {'h2' | 'h3'} [props.headingLevel]                default h2
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function FormSection({ title, description, headingLevel = 'h2', className, children }) {
    const headingId = useId();
    return (
        <section
            className={[styles.section, className].filter(Boolean).join(' ')}
            aria-labelledby={headingId}
        >
            <SectionHeader
                as={headingLevel}
                id={headingId}
                title={title}
                description={description}
                className={styles.sectionHeader}
            />
            <div className={styles.sectionBody}>{children}</div>
        </section>
    );
}
