// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Page templates: FormPage, FormSection, ListPage, EmptyState, SectionHeader.
//
// jsdom does no layout and evaluates no media queries, so the narrow/wide
// rule is proven in two halves: the DOM is identical at every width (no JS
// width check, no shell check), and the stylesheet carries the card only
// inside the one `(min-width: 600px)` block.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { FormSection } from '../../../packages/core/src/ui/FormSection.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import { EmptyState } from '../../../packages/core/src/ui/EmptyState.jsx';
import { SectionHeader } from '../../../packages/core/src/ui/SectionHeader.jsx';
import * as ui from '../../../packages/core/src/ui/index.js';

// Walk up from the cwd: under jsdom import.meta.url is an http: URL.
function uiDir() {
    let dir = process.cwd();
    while (!existsSync(join(dir, 'packages', 'core', 'src', 'ui'))) {
        const up = dirname(dir);
        if (up === dir) throw new Error('packages/core/src/ui not found above the cwd');
        dir = up;
    }
    return join(dir, 'packages', 'core', 'src', 'ui');
}
const css = (name) => readFileSync(join(uiDir(), name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The body of the first `@media <query> { ... }` block, braces balanced.
function mediaBlock(text, query) {
    const start = text.indexOf(`@media ${query}`);
    if (start < 0) return null;
    let i = text.indexOf('{', start);
    const open = i;
    let depth = 0;
    for (; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    return text.slice(open + 1, i);
}

// The declarations of the first rule whose selector is exactly `selector`.
function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const m = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return m ? m[2] : null;
}

// Everything outside @media blocks: the narrow (base) layer.
function baseLayer(text) {
    let out = '';
    let depth = 0;
    let inMedia = false;
    for (let i = 0; i < text.length; i += 1) {
        if (!inMedia && text.startsWith('@media', i)) { inMedia = true; depth = 0; }
        const ch = text[i];
        if (inMedia) {
            if (ch === '{') depth += 1;
            else if (ch === '}') { depth -= 1; if (depth === 0) { inMedia = false; continue; } }
            continue;
        }
        out += ch;
    }
    return out;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('page templates: exported from @xchain-wallet/core/ui', () => {
    it('exports every template primitive from the ui index', () => {
        for (const name of ['FormPage', 'FormSection', 'ListPage', 'EmptyState', 'SectionHeader']) {
            expect(typeof ui[name] === 'function' || typeof ui[name] === 'object', name).toBe(true);
        }
    });
});

describe('<FormPage>', () => {
    it('renders a named form landmark with the fields and the action row inside it', () => {
        render(
            <FormPage label="Verify signature" actions={<button type="submit">Verify</button>}>
                <label htmlFor="addr">Address</label>
                <input id="addr" />
            </FormPage>,
        );
        const form = screen.getByRole('form', { name: 'Verify signature' });
        expect(within(form).getByLabelText('Address')).toBeInTheDocument();
        expect(within(form).getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    });

    it('puts the action row last, after the fields and the status line', () => {
        const { container } = render(
            <FormPage status={<p>Problem</p>} actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        const kids = [...form.children];
        expect(kids.at(-1)).toContainElement(screen.getByRole('button', { name: 'Go' }));
        expect(kids.at(-2)).toHaveTextContent('Problem');
        expect(kids.at(-3)).toContainElement(screen.getByLabelText('Amount'));
    });

    it('calls onSubmit when the form is submitted, and skips browser validation by default', () => {
        const onSubmit = vi.fn((e) => e.preventDefault());
        const { container } = render(
            <FormPage onSubmit={onSubmit} actions={<button type="submit">Save</button>}>
                <input aria-label="Name" required />
            </FormPage>,
        );
        expect(container.querySelector('form')).toHaveAttribute('novalidate');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('forwards a ref to the form element', () => {
        const ref = createRef();
        render(<FormPage ref={ref}><input aria-label="x" /></FormPage>);
        expect(ref.current).toBeInstanceOf(HTMLFormElement);
    });

    it('renders the same DOM whatever the viewport or shell says', () => {
        // The width rule is CSS only: a JS width check would flash the wrong
        // layout on first paint and could disagree with the stylesheet.
        const tree = () => (
            <FormPage label="f" actions={<button type="submit">Go</button>}><input aria-label="a" /></FormPage>
        );
        vi.stubGlobal('matchMedia', (q) => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
        const wide = render(tree()).container.innerHTML;
        vi.stubGlobal('matchMedia', (q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
        const narrow = render(tree()).container.innerHTML;
        expect(narrow).toBe(wide);
    });

    it('marks a sectioned form so its sections, not the form, become cards', () => {
        const { container } = render(
            <FormPage sectioned>
                <FormSection title="Recipient"><input aria-label="To" /></FormSection>
            </FormPage>,
        );
        const form = container.querySelector('form');
        expect(form.className.split(' ').length).toBeGreaterThan(1);
        const plain = render(<FormPage><input aria-label="x" /></FormPage>).container.querySelector('form');
        expect(plain.className.split(' ').length).toBe(1);
    });
});

describe('FormPage.module.css: the narrow / wide rule', () => {
    const text = css('FormPage.module.css');
    const wide = mediaBlock(text, '(min-width: 600px)');

    it('has exactly one breakpoint, at 600px, and no container query', () => {
        expect(wide).not.toBeNull();
        expect(text.match(/@media/g)).toHaveLength(1);
        expect(text).not.toMatch(/@container|container-type/);
    });

    it('draws no card in the narrow base layer: the fields sit on the page gutter', () => {
        const base = baseLayer(text);
        const form = ruleBody(base, '.form');
        expect(form).toMatch(/padding:\s*0/);
        expect(form).not.toMatch(/background|border|box-shadow/);
        expect(ruleBody(base, '.section')).not.toMatch(/background|box-shadow/);
    });

    it('divides narrow sections with a rule above each heading after the first', () => {
        expect(ruleBody(baseLayer(text), '.section + .section')).toMatch(/border-top:\s*1px solid var\(--xc-border\)/);
    });

    it('puts a plain form in one centred 560px card when wide', () => {
        expect(ruleBody(wide, '.form')).toMatch(/max-width:\s*560px/);
        expect(ruleBody(wide, '.form')).toMatch(/margin:[^;]*auto/);
        const card = ruleBody(wide, '.form:not(.sectioned)');
        expect(card).toMatch(/background:\s*var\(--xc-surface-raised\)/);
        expect(card).toMatch(/border:\s*1px solid var\(--xc-border\)/);
        expect(card).toMatch(/padding:\s*var\(--xc-space-6\)/);
    });

    it('keeps the card inside the pane at the 600px tablet boundary', () => {
        const base = ruleBody(baseLayer(text), '.form');
        const tokens = css('tokens.css');
        expect(base).toMatch(/width:\s*100%/);
        expect(base).toMatch(/min-width:\s*0/);
        expect(tokens).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box/s);
    });

    it('stacks one card per section for a sectioned form when wide', () => {
        const card = ruleBody(wide, '.sectioned .section');
        expect(card).toMatch(/background:\s*var\(--xc-surface-raised\)/);
        expect(card).toMatch(/border:\s*1px solid var\(--xc-border\)/);
    });

    it('lets the action row wrap', () => {
        expect(ruleBody(text, '.actions')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('keeps raised page-card styling out of shared route CSS', () => {
        const routesDir = join(uiDir(), '..', 'shared', 'routes');
        const exceptions = new Set(['AddAddressModal.module.css']);
        const duplicates = [];

        for (const name of readdirSync(routesDir).filter((file) => file.endsWith('.module.css'))) {
            if (exceptions.has(name)) continue;
            const card = ruleBody(readFileSync(join(routesDir, name), 'utf8'), '.card');
            if (card
                && /background:\s*var\(--xc-surface-raised\)/.test(card)
                && /border:\s*1px solid var\(--xc-border\)/.test(card)
                && /border-radius:\s*var\(--xc-radius-lg\)/.test(card)
            ) {
                duplicates.push(name);
            }
        }

        expect(duplicates).toEqual([]);
    });
});

describe('<FormSection>', () => {
    it('is a region named by its own heading', () => {
        render(
            <FormPage sectioned>
                <FormSection title="Amount" description="How much to send">
                    <input aria-label="Value" />
                </FormSection>
            </FormPage>,
        );
        const region = screen.getByRole('region', { name: 'Amount' });
        expect(within(region).getByRole('heading', { level: 2, name: 'Amount' })).toBeInTheDocument();
        expect(region).toHaveTextContent('How much to send');
        expect(within(region).getByLabelText('Value')).toBeInTheDocument();
    });

    it('takes a lower heading level when nested', () => {
        render(<FormSection title="Fee" headingLevel="h3"><span /></FormSection>);
        expect(screen.getByRole('heading', { level: 3, name: 'Fee' })).toBeInTheDocument();
    });
});

describe('<ListPage>', () => {
    it('renders the toolbar above the content and passes extra props through', () => {
        render(
            <ListPage
                aria-label="Contacts"
                intro="Saved addresses."
                toolbar={<input type="search" aria-label="Search contacts" />}
            >
                <ul aria-label="Rows"><li>One</li></ul>
            </ListPage>,
        );
        const page = screen.getByLabelText('Contacts');
        const kids = [...page.children];
        expect(kids[0]).toHaveTextContent('Saved addresses.');
        expect(kids[1]).toContainElement(screen.getByRole('searchbox', { name: 'Search contacts' }));
        expect(kids[2]).toBe(screen.getByRole('list', { name: 'Rows' }));
    });

    it('omits the toolbar and intro when not given', () => {
        const { container } = render(<ListPage><p>Only</p></ListPage>);
        expect(container.firstChild.children).toHaveLength(1);
    });
});

describe('ListPage.module.css: readable list width', () => {
    const text = css('ListPage.module.css');

    it('fills narrow panes and caps wide panes at a centred readable measure', () => {
        expect(ruleBody(text, '.page')).toMatch(/width:\s*100%/);
        expect(ruleBody(text, '.page')).toMatch(/max-width:\s*48rem/);
        expect(ruleBody(text, '.page')).toMatch(/margin-inline:\s*auto/);
        expect(text).not.toMatch(/@media|@container/);
    });

    it('lets the toolbar wrap', () => {
        expect(ruleBody(text, '.toolbar')).toMatch(/flex-wrap:\s*wrap/);
    });
});

describe('<EmptyState>', () => {
    it('renders title, body and a status role', () => {
        render(<EmptyState title="No payments due" body="Matched orders that need a coin payment appear here." />);
        const region = screen.getByRole('status');
        expect(within(region).getByRole('heading', { level: 2, name: 'No payments due' })).toBeInTheDocument();
        expect(region).toHaveTextContent('Matched orders that need a coin payment appear here.');
        expect(within(region).queryByRole('button')).toBeNull();
    });

    it('renders the action only when both label and handler are given', () => {
        const onAction = vi.fn();
        const { rerender } = render(<EmptyState title="Empty" actionLabel="Receive" />);
        expect(screen.queryByRole('button')).toBeNull();
        rerender(<EmptyState title="Empty" actionLabel="Receive" onAction={onAction} />);
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        expect(onAction).toHaveBeenCalledOnce();
    });

    it('hides the decorative icon from assistive tech', () => {
        const { container } = render(<EmptyState title="Empty" icon={<svg data-testid="i" />} />);
        expect(container.querySelector('[aria-hidden="true"]')).toContainElement(screen.getByTestId('i'));
    });

    it('takes a lower heading level under a SectionHeader', () => {
        render(<EmptyState title="Nothing here" titleAs="h3" />);
        expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeInTheDocument();
    });
});

describe('<SectionHeader>', () => {
    it('renders an h2 by default with an optional description and trailing action', () => {
        render(
            <SectionHeader
                title="Expired"
                description="Do not pay these."
                trailing={<button type="button">Refresh</button>}
            />,
        );
        expect(screen.getByRole('heading', { level: 2, name: 'Expired' })).toBeInTheDocument();
        expect(screen.getByText('Do not pay these.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });

    it('honours the heading level and id', () => {
        render(<SectionHeader title="Rows" as="h3" id="rows-h" />);
        expect(screen.getByRole('heading', { level: 3 })).toHaveAttribute('id', 'rows-h');
    });
});

describe('template stylesheets: WebView 102 safe', () => {
    it('use no dvh, no container queries and no bare color-mix', () => {
        for (const file of ['FormPage.module.css', 'ListPage.module.css', 'EmptyState.module.css', 'SectionHeader.module.css']) {
            const text = css(file);
            expect(text, file).not.toMatch(/\bdvh\b|@container|color-mix\(/);
            // Colours come from tokens only, so dark mode and forced colors follow.
            expect(text, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        }
    });
});
