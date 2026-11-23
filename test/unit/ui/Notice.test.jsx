// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Notice Standard (operator pick 2026-11-15, style 2): one notice look, a
// tinted fill with a thin border of the same tone, 8px corners, the tone's
// icon, an optional bold title, an optional action and an optional close X in
// the top end corner. Two tones carry meaning: info (a note) and danger (a
// warning, an error or a critical caution, always red).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Notice, StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';
import * as ui from '../../../packages/core/src/ui/index.js';
import styles from '../../../packages/core/src/ui/StatusMessage.module.css';

afterEach(cleanup);

const css = readFileSync('packages/core/src/ui/StatusMessage.module.css', 'utf8');
const block = (selector) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
};

describe('Notice', () => {
    it('is the ui barrel export, and StatusMessage is the same component', () => {
        expect(ui.Notice).toBe(Notice);
        expect(StatusMessage).toBe(Notice);
    });

    it('draws the info tone as a polite status with the info icon', () => {
        render(<Notice tone="info">Tokens you receive show here after one confirmation.</Notice>);
        const box = screen.getByRole('status');
        expect(box).toHaveAttribute('aria-live', 'polite');
        expect(box).toHaveAttribute('data-tone', 'info');
        expect(box).toHaveClass(styles.row, styles.info);
        expect(box.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    });

    it('draws the danger tone as an assertive alert, red, with no X glyph as its icon', () => {
        render(<Notice tone="danger">Couldn't send. The amount is more than this address holds.</Notice>);
        const box = screen.getByRole('alert');
        expect(box).toHaveAttribute('aria-live', 'assertive');
        expect(box).toHaveAttribute('data-tone', 'danger');
        expect(box).toHaveAttribute('data-variant', 'error');
        expect(box).toHaveClass(styles.error);
        expect(box.querySelector('[aria-hidden="true"]')).not.toHaveTextContent('✕');
    });

    it('paints a warning red too, but keeps its polite announcement', () => {
        render(<Notice variant="warning">This wallet has never sent to this address before.</Notice>);
        const box = screen.getByRole('status');
        expect(box).toHaveAttribute('data-tone', 'danger');
        expect(box).toHaveAttribute('data-variant', 'warning');
    });

    it('uses warning semantics for a danger caution', () => {
        render(<Notice tone="danger" caution>This wallet has never sent to this address before.</Notice>);
        const box = screen.getByRole('status');
        expect(box).toHaveAttribute('data-tone', 'danger');
        expect(box).toHaveAttribute('data-variant', 'warning');
        expect(box).toHaveClass(styles.warning);
    });

    it('keeps a static critical caution out of the live regions with role note', () => {
        render(<Notice tone="danger" role="note">Never share your recovery phrase.</Notice>);
        const box = screen.getByRole('note');
        expect(box).not.toHaveAttribute('aria-live');
        expect(box).toHaveAttribute('data-tone', 'danger');
    });

    it.each([
        ['Notice', Notice],
        ['StatusMessage', StatusMessage],
    ])('puts a %s title in a block above the body, including inline title markup', (_name, Component) => {
        render(<Component tone="danger" title={<span>Never share your recovery phrase</span>}>Anyone with these words can take everything in this wallet.</Component>);
        const title = screen.getByText('Never share your recovery phrase');
        const body = screen.getByText('Anyone with these words can take everything in this wallet.');
        const titleBlock = title.parentElement;
        expect(titleBlock.tagName).toBe('DIV');
        expect(titleBlock).toHaveClass(styles.title);
        expect(titleBlock.nextElementSibling).toContainElement(body);
        expect(block('.title')).toMatch(/display:\s*block/);
    });

    it('renders nothing with neither a body nor a title', () => {
        const { container } = render(<Notice tone="info">{null}</Notice>);
        expect(container).toBeEmptyDOMElement();
    });

    it('offers one action as the small secondary button', () => {
        const onAction = vi.fn();
        render(<Notice tone="danger" action={{ label: 'Try again', onAction }}>Couldn't send.</Notice>);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onAction).toHaveBeenCalledOnce();
    });

    it('draws a named close X last in the box when it can be dismissed', () => {
        const onDismiss = vi.fn();
        render(<Notice tone="info" title="Auto backup is on" onDismiss={onDismiss} dismissLabel="Dismiss backup note">An encrypted copy saves after each change.</Notice>);
        const box = screen.getByRole('status');
        const close = screen.getByRole('button', { name: 'Dismiss backup note' });
        expect(box.lastElementChild).toBe(close);
        expect(close).toHaveAttribute('data-notice-dismiss');
        fireEvent.click(close);
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('names the close X "Dismiss Notice" by default and draws none without onDismiss', () => {
        const { rerender } = render(<Notice tone="danger" onDismiss={() => {}}>Couldn't send.</Notice>);
        expect(screen.getByRole('button', { name: 'Dismiss Notice' })).toBeInTheDocument();
        rerender(<Notice tone="danger">Couldn't send.</Notice>);
        expect(screen.queryByRole('button', { name: 'Dismiss Notice' })).toBeNull();
    });

    it('drops its outer margin when flush', () => {
        render(<Notice tone="danger" role="note" flush>Save this passphrase.</Notice>);
        expect(screen.getByRole('note')).toHaveClass(styles.flush);
        expect(block('.row.flush')).toMatch(/margin:\s*0/);
    });
});

describe('Notice look (style 2)', () => {
    it('tints each tone and draws a thin border of the same tone, with rounded corners', () => {
        expect(block('.row')).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
        expect(block('.row.status,\n.row.info')).toMatch(/background:\s*var\(--xc-info-bg\)[\s\S]*border:\s*1px solid var\(--xc-info\)/);
        expect(block('.row.warning,\n.row.error')).toMatch(/background:\s*var\(--xc-danger-bg\)[\s\S]*color:\s*var\(--xc-danger-text\)[\s\S]*border:\s*1px solid var\(--xc-danger\)/);
    });

    it('has no solid red fill and no coloured edge bar', () => {
        expect(css).not.toMatch(/background:\s*var\(--xc-danger\)\s*;/);
        expect(css).not.toMatch(/border-inline-start:\s*\d+px solid/);
        expect(css).not.toMatch(/--xc-on-danger/);
    });
});
