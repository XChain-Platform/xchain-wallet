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
import { parse } from '@babel/parser';
import postcss from 'postcss';
import { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { FormErrorSummary } from '../../../packages/core/src/ui/FormErrorSummary.jsx';
import { FormSection } from '../../../packages/core/src/ui/FormSection.jsx';
import { Input } from '../../../packages/core/src/ui/Input.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import { EmptyState } from '../../../packages/core/src/ui/EmptyState.jsx';
import { SectionHeader } from '../../../packages/core/src/ui/SectionHeader.jsx';
import * as ui from '../../../packages/core/src/ui/index.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

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
const coreSrcDir = () => join(uiDir(), '..');

function filesBelow(dir, suffix) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return filesBelow(path, suffix);
        return entry.name.endsWith(suffix) ? [path] : [];
    });
}

function routeTemplateRoots() {
    const routesDir = join(coreSrcDir(), 'shared', 'routes');
    const roots = new Map();

    for (const jsxPath of filesBelow(routesDir, '.jsx')) {
        const tree = parse(readFileSync(jsxPath, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const styleImports = new Map();
        for (const statement of tree.program.body) {
            if (statement.type !== 'ImportDeclaration' || !statement.source.value.endsWith('.module.css')) continue;
            const local = statement.specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier')?.local.name;
            if (local) styleImports.set(local, join(dirname(jsxPath), statement.source.value));
        }

        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'JSXOpeningElement'
                && node.name.type === 'JSXIdentifier'
                && ['Screen', 'ListPage', 'FormPage'].includes(node.name.name)
            ) {
                const className = node.attributes.find((attribute) => attribute.type === 'JSXAttribute'
                    && attribute.name.name === 'className')?.value?.expression;
                if (className?.type === 'MemberExpression'
                    && className.object.type === 'Identifier'
                    && className.property.type === 'Identifier'
                    && styleImports.has(className.object.name)
                ) {
                    const cssPath = styleImports.get(className.object.name);
                    if (!roots.has(cssPath)) roots.set(cssPath, new Set());
                    roots.get(cssPath).add(className.property.name);
                }
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
    }
    return roots;
}

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
        for (const name of ['FormPage', 'FormErrorSummary', 'FormSection', 'ListPage', 'EmptyState', 'SectionHeader']) {
            expect(typeof ui[name] === 'function' || typeof ui[name] === 'object', name).toBe(true);
        }
    });
});

describe('<FormErrorSummary>', () => {
    it('takes focus and links every error to its field', () => {
        render(
            <form>
                <label htmlFor="ticker">Ticker</label>
                <input id="ticker" />
                <label htmlFor="amount">Amount</label>
                <input id="amount" />
                <FormErrorSummary errors={[
                    { id: 'ticker', label: 'Ticker', message: 'Ticker is required.' },
                    { id: 'amount', label: 'Amount', message: 'Amount must be positive.' },
                ]} focusKey={1} />
            </form>,
        );

        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(document.activeElement).toBe(summary);
        expect(within(summary).getByText('Fix these 2 fields:')).toBeInTheDocument();
        const links = within(summary).getAllByRole('link');
        expect(links.map((link) => link.getAttribute('href'))).toEqual(['#ticker', '#amount']);

        fireEvent.click(links[1]);
        expect(document.activeElement).toBe(screen.getByLabelText('Amount'));
    });

    it('names the field once when the message already opens with its label', () => {
        render(
            <FormErrorSummary errors={[
                { id: 'password', label: 'Password', message: 'Password must be at least 8 characters.' },
                { id: 'w5', label: 'Word 5', message: 'Word 5 does not match your written copy.' },
                { id: 'w1', label: 'Word 1', message: 'Word 12 is missing.' },
                { id: 'confirm', label: 'Confirm password', message: 'Passwords do not match.' },
            ]} focusKey={1} />,
        );

        const links = within(screen.getByRole('alert', { name: 'Form errors' })).getAllByRole('link');
        expect(links.map((link) => link.textContent)).toEqual([
            'Password must be at least 8 characters.',
            'Word 5 does not match your written copy.',
            'Word 1: Word 12 is missing.',
            'Confirm password: Passwords do not match.',
        ]);
    });

    it('does not show a summary until the form has been submitted', () => {
        const errors = [{ id: 'amount', label: 'Amount', message: 'Amount must be positive.' }];
        const { rerender } = render(<FormErrorSummary errors={errors} focusKey={0} />);

        expect(screen.queryByRole('alert', { name: 'Form errors' })).toBeNull();

        rerender(<FormErrorSummary errors={errors} focusKey={1} />);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toBeInTheDocument();
    });

    it('focuses the same error again when the submit attempt changes', () => {
        const errors = [{ id: 'amount', label: 'Amount', message: 'Amount must be positive.' }];
        const { rerender } = render(
            <>
                <input id="amount" aria-label="Amount" />
                <FormErrorSummary errors={errors} focusKey={1} />
            </>,
        );
        screen.getByLabelText('Amount').focus();

        rerender(
            <>
                <input id="amount" aria-label="Amount" />
                <FormErrorSummary errors={errors} focusKey={2} />
            </>,
        );

        expect(document.activeElement).toBe(screen.getByRole('alert', { name: 'Form errors' }));
    });

    it('does not describe a submit failure as a field error', () => {
        render(
            <FormErrorSummary errors={[
                { message: "Couldn't send. Something went wrong. Try again." },
            ]} focusKey={1} />,
        );

        const summary = screen.getByRole('alert', { name: 'Form errors' });
        expect(within(summary).getByText("Couldn't send. Something went wrong. Try again.")).toBeInTheDocument();
        expect(within(summary).queryByText(/Fix (?:this|these).*field/)).not.toBeInTheDocument();
        expect(within(summary).queryByRole('link')).not.toBeInTheDocument();
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

    it('puts the notice first, the fields next and the action row last', () => {
        const { container } = render(
            <FormPage status={<p>Problem</p>} actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
            </FormPage>,
        );
        const form = container.querySelector('form');
        // The notice leads the page just above the form (its card, when wide).
        const page = [...form.parentElement.children];
        expect(page).toHaveLength(2);
        expect(page[0]).toHaveTextContent('Problem');
        expect(page[1]).toBe(form);
        const kids = [...form.children];
        expect(kids.at(-1)).toContainElement(screen.getByRole('button', { name: 'Go' }));
        expect(kids.at(-2)).toContainElement(screen.getByLabelText('Amount'));
        expect(form).not.toHaveTextContent('Problem');
    });

    it('keeps the same form and the focused field when a notice comes and goes', () => {
        const page = (status) => (
            <FormPage label="Pay" status={status} actions={<button type="submit">Go</button>}>
                <input aria-label="Amount" />
            </FormPage>
        );
        const { rerender } = render(page(null));
        const form = screen.getByRole('form', { name: 'Pay' });
        const amount = screen.getByLabelText('Amount');
        amount.focus();

        rerender(page(<p role="alert">Problem</p>));
        expect(screen.getByRole('form', { name: 'Pay' })).toBe(form);
        expect(screen.getByLabelText('Amount')).toBe(amount);
        expect(document.activeElement).toBe(amount);

        rerender(page(null));
        expect(screen.getByRole('form', { name: 'Pay' })).toBe(form);
        expect(document.activeElement).toBe(amount);
    });

    it('lets an error summary above the form take focus and lead to its field', () => {
        render(
            <FormPage
                label="Pay"
                status={<FormErrorSummary errors={[{ id: 'pay-amount', label: 'Amount', message: 'Enter an amount.' }]} focusKey={1} />}
                actions={<button type="submit">Go</button>}
            >
                <input id="pay-amount" aria-label="Amount" />
            </FormPage>,
        );
        const summary = screen.getByRole('alert');
        const form = screen.getByRole('form', { name: 'Pay' });
        expect(form).not.toContainElement(summary);
        expect(document.activeElement).toBe(summary);
        fireEvent.click(within(summary).getByRole('link'));
        expect(document.activeElement).toBe(screen.getByLabelText('Amount'));
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

    it('renders a reusable form fragment without nesting another form', () => {
        render(
            <form aria-label="Parent form">
                <FormPage as="div" label="Embedded fields">
                    <input aria-label="Name" />
                </FormPage>
            </form>,
        );

        const fragment = screen.getByRole('group', { name: 'Embedded fields' });
        expect(fragment.tagName).toBe('DIV');
        expect(within(fragment).queryByRole('form')).toBeNull();
        expect(within(fragment).getByLabelText('Name')).toBeInTheDocument();
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

    it('marks a sectioned form so its sections receive shared divider spacing', () => {
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

    it('separates sections with a divider and the shared section gap token', () => {
        const base = baseLayer(text);
        expect(ruleBody(base, '.sectioned > .body')).toMatch(/gap:\s*var\(--xc-section-gap\)/);
        expect(ruleBody(base, '.section + .section')).toMatch(/padding-top:\s*var\(--xc-section-gap\)/);
        expect(ruleBody(base, '.section + .section')).toMatch(/border-top:\s*1px solid var\(--xc-border\)/);
    });

    it('puts every form in one centred 560px card when wide', () => {
        const card = ruleBody(wide, '.form');
        expect(css('tokens.css')).toMatch(/--xc-form-card-max-width:\s*560px/);
        expect(card).toMatch(/max-width:\s*var\(--xc-form-card-max-width\)/);
        expect(card).toMatch(/margin:\s*0 auto/);
        expect(card).toMatch(/background:\s*var\(--xc-card-bg\)/);
        expect(card).toMatch(/border:\s*var\(--xc-card-border\)/);
        expect(card).toMatch(/border-radius:\s*var\(--xc-card-radius\)/);
        expect(card).toMatch(/padding:\s*var\(--xc-card-pad\)/);
    });

    it('keeps the card inside the pane at the 600px tablet boundary', () => {
        const base = ruleBody(baseLayer(text), '.form');
        const tokens = css('tokens.css');
        expect(base).toMatch(/width:\s*100%/);
        expect(base).toMatch(/min-width:\s*0/);
        expect(tokens).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box/s);
    });

    it('keeps sections bare inside the sectioned form card when wide', () => {
        expect(ruleBody(wide, '.sectioned > .body > .section')).toBeNull();
        expect(ruleBody(wide, '.sectioned > .body > .section + .section')).toBeNull();
    });

    it('flattens a reusable form fragment inside its parent form card', () => {
        const fragment = ruleBody(wide, 'form .form');
        expect(fragment).toMatch(/max-width:\s*none/);
        expect(fragment).toMatch(/padding:\s*0/);
        expect(fragment).toMatch(/background:\s*transparent/);
        expect(fragment).toMatch(/box-shadow:\s*none/);
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

    it('separates sibling fields with the shared form gap token', () => {
        render(
            <FormSection title="Recipient">
                <Input label="Address" />
                <Input label="Amount" />
            </FormSection>,
        );

        // The label is a direct child of the field wrapper; the input sits one
        // level deeper inside the control hit area.
        const addressField = screen.getByText('Address', { selector: 'label' }).parentElement;
        const amountField = screen.getByText('Amount', { selector: 'label' }).parentElement;
        expect(addressField.parentElement).toBe(amountField.parentElement);
        expect([...addressField.parentElement.children]).toEqual([addressField, amountField]);
        expect(ruleBody(css('FormPage.module.css'), '.sectionBody'))
            .toMatch(/gap:\s*var\(--xc-form-gap\)/);
        expect(css('tokens.css')).toMatch(/--xc-form-gap:\s*var\(--xc-space-4\)/);
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

describe('ListPage.module.css: fluid list width', () => {
    const text = css('ListPage.module.css');

    it('fills the Screen content box without adding page geometry', () => {
        expect(ruleBody(text, '.page')).toMatch(/width:\s*100%/);
        expect(ruleBody(text, '.page')).not.toMatch(/max-width|margin(?:-inline)?\s*:/);
        expect(text).not.toMatch(/@media|@container/);
    });

    it('lets the toolbar wrap', () => {
        expect(ruleBody(text, '.toolbar')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('uses the shared section rhythm and tightens a header to its content', () => {
        expect(ruleBody(text, '.page')).toMatch(/gap:\s*var\(--xc-section-gap\)/);
        expect(ruleBody(text, '.page > [data-xc-section-header] + *'))
            .toMatch(/margin-block-start:\s*calc\(var\(--xc-section-header-gap\) - var\(--xc-section-gap\)\)/);
    });
});

describe('page gutter ownership', () => {
    const screenPath = join(uiDir(), 'Screen.module.css');
    const screenText = readFileSync(screenPath, 'utf8');
    const screenRoot = postcss.parse(screenText);

    it('keeps page gutter use in Screen and tier values in the shell', () => {
        const users = filesBelow(coreSrcDir(), '.module.css')
            .filter((file) => readFileSync(file, 'utf8').includes('var(--xc-page-gutter)'));
        expect(users).toEqual([screenPath]);

        const tokens = css('tokens.css');
        expect(tokens).toMatch(/--xc-page-gutter:\s*var\(--xc-space-3\)/);
        expect(tokens).toMatch(/--xc-page-top:\s*var\(--xc-space-3\)/);

        const shell = readFileSync(join(coreSrcDir(), 'shared', 'components', 'LeftNav.module.css'), 'utf8');
        // One gutter on every tier: the shell sets only the top inset per tier.
        expect(shell).not.toMatch(/--xc-page-gutter:/);
        expect(shell).toMatch(/data-xc-tier='rail'[^}]*--xc-page-top:\s*var\(--xc-space-4\)/s);
        expect(shell).toMatch(/data-xc-tier='full'[^}]*--xc-page-top:\s*var\(--xc-space-4\)/s);
        expect(shell).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\) and \(min-aspect-ratio: 3\/2\)[\s\S]*--xc-page-top:\s*var\(--xc-space-2\)/);
    });

    it('keeps scrolling, an end-edge scrollbar lane, and page padding on Screen body', () => {
        const body = screenRoot.nodes.find((node) => node.type === 'rule' && node.selector === '.body');
        const declarations = Object.fromEntries(body.nodes
            .filter((node) => node.type === 'decl')
            .map((node) => [node.prop, node.value]));
        expect(declarations.padding).toBe('var(--xc-page-top) var(--xc-page-gutter)');
        // Safari 16 lacks scrollbar-gutter, so the reservation sits behind @supports.
        const guarded = screenRoot.nodes.find((node) => node.type === 'atrule'
            && node.name === 'supports' && node.params === '(scrollbar-gutter: stable)');
        const guardedBody = guarded?.nodes.find((node) => node.type === 'rule' && node.selector === '.body');
        expect(guardedBody?.nodes.find((node) => node.prop === 'scrollbar-gutter')?.value).toBe('stable');
        const guardedScrollArea = guarded?.nodes.find((node) => node.type === 'rule' && node.selector === '.scrollArea');
        expect(guardedScrollArea?.nodes.find((node) => node.prop === 'scrollbar-gutter')?.value).toBe('stable');
        expect(declarations).not.toHaveProperty('scrollbar-width');
        expect(declarations).not.toHaveProperty('scrollbar-color');
    });

    it('keeps route template root classes free of page geometry', () => {
        const faults = [];
        const roots = routeTemplateRoots();
        expect([...roots.values()].reduce((count, names) => count + names.size, 0)).toBeGreaterThan(3);

        for (const [file, classNames] of roots) {
            const stylesheet = postcss.parse(readFileSync(file, 'utf8'));
            stylesheet.walkRules((rule) => {
                if (rule.parent.type !== 'root') return;
                for (const className of classNames) {
                    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const directRoot = new RegExp(`^\\.${escaped}(?:\\.${escaped})*(?::[\\w-]+(?:\\([^)]*\\))?)*$`);
                    if (!rule.selectors?.some((selector) => directRoot.test(selector.trim()))) continue;
                    rule.walkDecls(/^(?:padding(?:-.+)?|margin(?:-.+)?|max-width)$/, (decl) => {
                        faults.push(`${file}:${decl.source.start.line} .${className} sets ${decl.prop}`);
                    });
                }
            });
        }

        expect(faults).toEqual([]);
    });

    it('guards every relational selector for Chrome 102', () => {
        const faults = [];
        for (const file of filesBelow(coreSrcDir(), '.module.css')) {
            postcss.parse(readFileSync(file, 'utf8')).walkRules((rule) => {
                if (!rule.selector.includes(':has(')) return;
                let parent = rule.parent;
                while (parent && !(parent.type === 'atrule'
                    && parent.name === 'supports'
                    && parent.params.includes('selector(:has('))) parent = parent.parent;
                if (!parent) faults.push(file);
            });
        }
        expect(faults).toEqual([]);
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
        expect(screen.getByRole('heading', { name: 'Expired' }).parentElement.parentElement)
            .toHaveAttribute('data-xc-section-header');
    });

    it('honours the heading level and id', () => {
        render(<SectionHeader title="Rows" as="h3" id="rows-h" />);
        expect(screen.getByRole('heading', { level: 3 })).toHaveAttribute('id', 'rows-h');
    });
});

describe('list page rhythm tokens', () => {
    const tokens = css('tokens.css');
    const sectionHeader = css('SectionHeader.module.css');
    const emptyState = css('EmptyState.module.css');
    const balanceList = readFileSync(
        join(coreSrcDir(), 'shared', 'components', 'BalanceList.module.css'),
        'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    it('defines one section gap, header gap, and list row padding', () => {
        expect(tokens).toMatch(/--xc-section-gap:\s*var\(--xc-space-4\)/);
        expect(tokens).toMatch(/--xc-section-header-gap:\s*var\(--xc-space-2\)/);
        expect(tokens).toMatch(/--xc-list-row-padding:\s*var\(--xc-space-3\)/);
    });

    it('uses gaps instead of child margins inside headers and empty states', () => {
        expect(ruleBody(sectionHeader, '.text')).toMatch(/gap:\s*var\(--xc-space-1\)/);
        expect(ruleBody(sectionHeader, '.description')).toMatch(/margin:\s*0/);
        expect(ruleBody(emptyState, '.wrap')).toMatch(/gap:\s*var\(--xc-section-header-gap\)/);
        expect(ruleBody(emptyState, '.actions')).not.toMatch(/margin/);
    });

    it('uses the shared padding for balance rows and list footer rows', () => {
        expect(ruleBody(balanceList, '.row')).toMatch(/padding:\s*var\(--xc-list-row-padding\)/);
        expect(ruleBody(balanceList, '.hiddenToggle')).toMatch(/padding:\s*var\(--xc-list-row-padding\)/);
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

// Every early return of a route's wrap() helper (the load error, the loading
// line and the done stage) lays out through a template, the same as the form
// and review stages, so the notice and the result panel keep the template
// rhythm instead of sitting bare in the Screen content box.
function wrapCallRoots(fileName) {
    const path = join(coreSrcDir(), 'shared', 'routes', fileName);
    const tree = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const roots = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression'
            && node.callee.type === 'Identifier'
            && node.callee.name === 'wrap'
        ) {
            const arg = node.arguments[0];
            const line = node.loc.start.line;
            if (arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier') {
                roots.push({ line, name: arg.openingElement.name.name });
            } else {
                roots.push({ line, name: arg?.type || 'none' });
            }
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(tree.program);
    return roots;
}

describe('route wrap() returns: every stage lays out through a template', () => {
    it('TokenAdminForm passes ListPage, FormPage or ResultScreen to every wrap() call', () => {
        const roots = wrapCallRoots('TokenAdminForm.jsx');
        expect(roots.length).toBeGreaterThan(4);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage', 'ResultScreen'].includes(name))
            .map(({ line, name }) => `TokenAdminForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });
});

// DelegateVoteForm's wrap() helper is a bare Screen. The load error, the
// loading line, both ResultScreen states and the done panel reach the page
// through the ListPage each wrap() call passes, and the review and form
// stages through FormPage, so no state draws straight into the Screen box.
describe('DelegateVoteForm: every wrap() call passes ListPage or FormPage', () => {
    it('roots the load error, loading line, done panels, review and form in a template', () => {
        const roots = wrapCallRoots('DelegateVoteForm.jsx');
        expect(roots.length).toBeGreaterThanOrEqual(7);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage'].includes(name))
            .map(({ line, name }) => `DelegateVoteForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });
});

// A route's load error, loading line and result panel lay out through a page
// template like its form does, so the page edge and rhythm match the form
// stage on every shell. MintForm puts each one inside ListPage within the
// same Screen.
describe('MintForm: every stage renders inside a page template', () => {
    const CHAIN_ID = 'bitcoin-mainnet';
    const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
    const ADDRESSES = {
        [CHAIN_ID]: [{
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        }],
    };

    afterEach(() => {
        __clearTokenInfoCache();
    });

    // The root class of each template, read from the component itself so the
    // check follows the CSS-module naming the test run uses.
    function templateClasses() {
        const list = render(<ListPage><p>x</p></ListPage>);
        const listClass = list.container.firstChild.className.split(' ')[0];
        list.unmount();
        const form = render(<FormPage onSubmit={() => {}} label="x"><p>x</p></FormPage>);
        const formClass = form.container.querySelector('form').className.split(' ')[0];
        form.unmount();
        return [listClass, formClass];
    }

    function expectInsideTemplate(element) {
        const selector = templateClasses().map((name) => `.${CSS.escape(name)}`).join(', ');
        expect(element.closest(selector), 'inside ListPage or FormPage').not.toBeNull();
    }

    function mountMint(overrides = {}) {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            isUnlocked: vi.fn().mockResolvedValue(true),
            getTokenInfo: vi.fn(async () => ({
                chainId: CHAIN_ID,
                tick: 'CAPTEST',
                creator: ADDRESS,
                maxSupply: '5000',
                totalSupply: '1000',
                mintMax: null,
                divisibility: 0,
                locks: {},
            })),
            composeForConfirm: vi.fn(async () => ({
                psbt: 'aa00',
                encoding: 'psbt',
                actionString: 'MINT|0|CAPTEST|4000',
                version: 1,
                chainId: CHAIN_ID,
                decoded: { summary: 'Mint 4,000 CAPTEST', details: [], warnings: [] },
            })),
            preflight: vi.fn(async () => ({
                schemaVersion: 1, verdict: 'pass', restricted: false, checksRun: ['local'],
                findings: [], unverified: [], quote: null, stateHeight: 1, elapsedMs: 1,
            })),
            checkInputLiveness: vi.fn(async () => ({ verdict: 'live' })),
            releaseEncoderInputs: vi.fn(async () => undefined),
            reserve: vi.fn(async () => ({ id: 'reservation' })),
            releaseReservation: vi.fn(async () => undefined),
            mintToken: vi.fn(async () => ({ txid: 'ab'.repeat(32) })),
            ...overrides,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                return property in target ? target[property] : undefined;
            },
        });
        render(
            <MessagingProvider shell="desktop" messaging={proxy}>
                <MintForm walletId="w" initialChainId={CHAIN_ID} initialTick="CAPTEST" onBack={() => {}} />
            </MessagingProvider>,
        );
        return messaging;
    }

    it('lays out the load error inside a template', async () => {
        mountMint({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        const status = await screen.findByText(/Address store unavailable|Failed to load addresses/);
        expectInsideTemplate(status);
    });

    it('lays out the loading line inside a template', () => {
        mountMint({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        expectInsideTemplate(screen.getByText('Loading…'));
    });

    it('lays out the done result inside a template', async () => {
        const messaging = mountMint();
        await screen.findByText(/4,000 CAPTEST available to mint/);
        fireEvent.change(await screen.findByLabelText(/^Amount\b/), { target: { value: '4000' } });
        fireEvent.click(screen.getByRole('button', { name: /^Mint$/ }));
        const approve = await screen.findByRole('button', { name: /^Approve$/ });
        await waitFor(() => expect(approve).not.toBeDisabled());
        fireEvent.click(approve);
        const title = await screen.findByText('Minted');
        expect(messaging.mintToken).toHaveBeenCalledTimes(1);
        expectInsideTemplate(title);
        expectInsideTemplate(screen.getByRole('button', { name: 'Done' }));
    });
});

// SleepForm's wrap() helper is a bare Screen, so the load error, the loading
// line and every done-stage panel reach the page only through the FormPage
// each wrap() call passes; a StatusMessage, hint line, ResultScreen or
// fragment handed straight to wrap() sits in the Screen box with no template.
describe('SleepForm: every wrap() call passes a FormPage', () => {
    function sleepFormWrapRoots() {
        const path = join(coreSrcDir(), 'shared', 'routes', 'SleepForm.jsx');
        const tree = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const roots = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
                const arg = node.arguments[0];
                const name = arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                    ? arg.openingElement.name.name
                    : (arg?.type || 'none');
                roots.push({ line: node.loc.start.line, name, arg });
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
        return roots;
    }

    const hasDescendant = (node, test) => {
        if (!node || typeof node !== 'object') return false;
        if (test(node)) return true;
        return Object.values(node).some((value) => (Array.isArray(value)
            ? value.some((item) => hasDescendant(item, test))
            : (value && typeof value === 'object' ? hasDescendant(value, test) : false)));
    };
    const opens = (name) => (node) => node.type === 'JSXOpeningElement'
        && node.name.type === 'JSXIdentifier' && node.name.name === name;

    it('roots the load error, the loading line, the done panels, review and form in FormPage', () => {
        const roots = sleepFormWrapRoots();
        expect(roots.length).toBeGreaterThanOrEqual(7);
        const faults = roots
            .filter(({ name }) => name !== 'FormPage')
            .map(({ line, name }) => `SleepForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });

    it('keeps the load error, the loading line and both ResultScreen states inside those FormPages', () => {
        const roots = sleepFormWrapRoots();
        const holding = (test) => roots.filter(({ arg }) => hasDescendant(arg, test));
        expect(holding((node) => node.type === 'Identifier' && node.name === 'loadError')
            .map(({ name }) => name)).toEqual(['FormPage']);
        expect(holding((node) => node.type === 'JSXText' && node.value.includes('Loading…'))
            .map(({ name }) => name)).toEqual(['FormPage']);
        expect(holding(opens('ResultScreen')).map(({ name }) => name)).toEqual(['FormPage', 'FormPage']);
        expect(holding((node) => node.type === 'JSXText' && node.value.includes('broadcast'))
            .map(({ name }) => name)).toContain('FormPage');
    });
});

// DividendForm's wrap() helper is a bare Screen. The load error, the loading
// line and the done-stage result reach the page through the FormPage each
// wrap() call passes, the same template the form and review stages use, so
// none of them sits in the Screen box with no template edge or rhythm.
describe('DividendForm: every stage renders inside FormPage', () => {
    const CHAIN_ID = 'bitcoin-mainnet';

    function formPageClass() {
        const form = render(<FormPage onSubmit={() => {}} label="x"><p>x</p></FormPage>);
        const name = form.container.querySelector('form').className.split(' ')[0];
        form.unmount();
        return name;
    }

    function expectInsideFormPage(element) {
        expect(element.closest(`.${CSS.escape(formPageClass())}`), 'inside FormPage').not.toBeNull();
    }

    async function mountDividend(overrides = {}) {
        const { MessagingProvider: Provider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
        const { DividendForm } = await import('../../../packages/core/src/shared/routes/DividendForm.jsx');
        const messaging = {
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            isUnlocked: vi.fn().mockResolvedValue(true),
            ...overrides,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                return property in target ? target[property] : undefined;
            },
        });
        render(
            <Provider shell="desktop" messaging={proxy}>
                <DividendForm walletId="w" initialChainId={CHAIN_ID} onBack={() => {}} />
            </Provider>,
        );
    }

    it('lays out the load error inside FormPage', async () => {
        await mountDividend({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        expectInsideFormPage(await screen.findByText('Address store unavailable'));
    });

    it('lays out the loading line inside FormPage while addresses are unloaded', async () => {
        await mountDividend({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        expectInsideFormPage(screen.getByText('Loading…'));
    });

    it('passes a FormPage to every wrap() call, the done-stage results included', () => {
        const path = join(coreSrcDir(), 'shared', 'routes', 'DividendForm.jsx');
        const tree = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const roots = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
                const arg = node.arguments[0];
                roots.push({
                    line: node.loc.start.line,
                    name: arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                        ? arg.openingElement.name.name
                        : (arg?.type || 'none'),
                });
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
        expect(roots.length).toBeGreaterThanOrEqual(7);
        expect(roots.filter(({ name }) => name !== 'FormPage')
            .map(({ line, name }) => `DividendForm.jsx:${line} wrap(${name})`)).toEqual([]);
    });
});

// AdvancedActionsForm's wrap() helper is a bare Screen. The signer-mode
// notice, the load error, the loading line and every done-stage panel reach
// the page through the ListPage each wrap() call passes, and the form and
// review stages through FormPage, so no state draws straight into the
// Screen content box.
describe('AdvancedActionsForm: every wrap() call passes a page template', () => {
    function advancedWrapRoots() {
        const path = join(coreSrcDir(), 'shared', 'routes', 'AdvancedActionsForm.jsx');
        const tree = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const roots = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
                const arg = node.arguments[0];
                const name = arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                    ? arg.openingElement.name.name
                    : (arg?.type || 'none');
                roots.push({ line: node.loc.start.line, name, arg });
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
        return roots;
    }

    const holds = (node, test) => {
        if (!node || typeof node !== 'object') return false;
        if (test(node)) return true;
        return Object.values(node).some((value) => (Array.isArray(value)
            ? value.some((item) => holds(item, test))
            : (value && typeof value === 'object' ? holds(value, test) : false)));
    };

    it('roots the signer notice, load error, loading line, done panels, review and form in ListPage or FormPage', () => {
        const roots = advancedWrapRoots();
        expect(roots.length).toBeGreaterThanOrEqual(8);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage'].includes(name))
            .map(({ line, name }) => `AdvancedActionsForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });

    it('keeps the signer notice, load error, loading line and both ResultScreen states inside ListPage', () => {
        const roots = advancedWrapRoots();
        const rootsHolding = (test) => roots.filter(({ arg }) => holds(arg, test)).map(({ name }) => name);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('signer mode'))).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'Identifier' && node.name === 'loadError')).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('Loading…'))).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXOpeningElement'
            && node.name.type === 'JSXIdentifier' && node.name.name === 'ResultScreen')).toEqual(['ListPage', 'ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('Broadcast complete.'))).toEqual(['ListPage']);
    });
});

// The official-token list flow roots every wrap() state in a template: the
// watcher-mode refusal, both load errors, the loading line, the queued panel,
// the done panel and the wait for indexing sit in ListPage, and the compose
// and review stages in FormPage.
describe('ProjectRosterForm: every wrap() state lays out through a template', () => {
    it('roots each of its wrap() calls in ListPage or FormPage', () => {
        const roots = wrapCallRoots('ProjectRosterForm.jsx');
        expect(roots.length).toBeGreaterThanOrEqual(10);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage'].includes(name))
            .map(({ line, name }) => `ProjectRosterForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });
});

// BatchComposerForm's wrap() helper is a bare Screen. The load error, the
// loading line, both ResultScreen states and the broadcast panel reach the
// page through the ListPage each wrap() call passes, and the review stage
// through FormPage, so no state draws straight into the Screen content box.
describe('BatchComposerForm: every wrap() call passes a page template', () => {
    function batchWrapRoots() {
        const path = join(coreSrcDir(), 'shared', 'routes', 'BatchComposerForm.jsx');
        const tree = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const roots = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
                const arg = node.arguments[0];
                const name = arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                    ? arg.openingElement.name.name
                    : (arg?.type || 'none');
                roots.push({ line: node.loc.start.line, name, arg });
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
        return roots;
    }

    const holds = (node, test) => {
        if (!node || typeof node !== 'object') return false;
        if (test(node)) return true;
        return Object.values(node).some((value) => (Array.isArray(value)
            ? value.some((item) => holds(item, test))
            : (value && typeof value === 'object' ? holds(value, test) : false)));
    };

    it('roots the load error, loading line, done panels and review in ListPage or FormPage', () => {
        const roots = batchWrapRoots();
        expect(roots.length).toBeGreaterThanOrEqual(6);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage'].includes(name))
            .map(({ line, name }) => `BatchComposerForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });

    it('keeps the load error, loading line, both ResultScreen states and the broadcast panel inside ListPage', () => {
        const roots = batchWrapRoots();
        const rootsHolding = (test) => roots.filter(({ arg }) => holds(arg, test)).map(({ name }) => name);
        expect(rootsHolding((node) => node.type === 'Identifier' && node.name === 'loadError')).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('Loading wallet'))).toEqual(['ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXOpeningElement'
            && node.name.type === 'JSXIdentifier' && node.name.name === 'ResultScreen')).toEqual(['ListPage', 'ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('Batch broadcast'))).toEqual(['ListPage']);
    });
});

// CreatePollForm's wrap() helper is a bare Screen. The load error and the
// loading line reach the page through a ListPage inside that Screen, the same
// as the done panel, so neither draws straight into the Screen content box.
describe('CreatePollForm: the load error and loading line render inside ListPage', () => {
    const CHAIN_ID = 'bitcoin-mainnet';

    function listPageClass() {
        const list = render(<ListPage><p>x</p></ListPage>);
        const name = list.container.firstChild.className.split(' ')[0];
        list.unmount();
        return name;
    }

    function mountPoll(overrides = {}) {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            ...overrides,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                if (property in target) return target[property];
                if (typeof property !== 'string') return undefined;
                return vi.fn().mockResolvedValue(null);
            },
        });
        return render(
            <MessagingProvider shell="desktop" messaging={proxy}>
                <CreatePollForm walletId="w" chainId={CHAIN_ID} presetTick="VOTE" onBack={() => {}} />
            </MessagingProvider>,
        );
    }

    function expectInListPageWithinScreen(element, container) {
        const page = element.closest(`.${CSS.escape(listPageClass())}`);
        expect(page, 'inside ListPage').not.toBeNull();
        expect(page.parentElement, 'ListPage is not the Screen root').not.toBe(container);
        expect(container.contains(page)).toBe(true);
    }

    it('lays out the load error inside ListPage', async () => {
        const { container } = mountPoll({
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')),
        });
        const status = await screen.findByText('Address store unavailable');
        expectInListPageWithinScreen(status, container);
    });

    it('lays out the loading line inside ListPage', () => {
        const { container } = mountPoll({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        expectInListPageWithinScreen(screen.getByText('Loading addresses…'), container);
    });
});

// SwapForm's wrap() helper is a bare Screen. The load error, the loading
// line, both ResultScreen states and the sent panel reach the page through
// the FormPage each wrap() call passes, like the review and form stages, and
// the offline notice sits in that FormPage's status region instead of
// straight in the Screen content box.
describe('SwapForm: every stage renders inside FormPage', () => {
    const SWAP_CHAIN = 'bitcoin-mainnet';

    async function mountSwap(overrides = {}) {
        const { SwapForm } = await import('../../../packages/core/src/shared/routes/SwapForm.jsx');
        const { createElement } = await import('react');
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [SWAP_CHAIN]: [{ id: 'swap-a1', address: 'bc1qsendersendersendersendersendersendersa', source: 'hd', signerId: 's' }],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            ...overrides,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                if (property in target) return target[property];
                if (typeof property !== 'string') return undefined;
                return vi.fn().mockResolvedValue(null);
            },
        });
        return render(createElement(
            MessagingProvider,
            { shell: 'web', messaging: proxy },
            createElement(SwapForm, { walletId: 'w', onBack() {} }),
        ));
    }

    afterEach(() => {
        delete navigator.onLine;
    });

    it('passes a FormPage to every wrap() call, the done-stage results included', () => {
        const roots = wrapCallRoots('SwapForm.jsx');
        expect(roots.length).toBeGreaterThanOrEqual(6);
        const faults = roots
            .filter(({ name }) => name !== 'FormPage')
            .map(({ line, name }) => `SwapForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });

    it('lays out the load error in the FormPage status region', async () => {
        await mountSwap({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        const status = await screen.findByText('Address store unavailable');
        expect(status.closest('[data-form-status]'), 'inside the FormPage status').not.toBeNull();
    });

    it('lays out the loading line in the FormPage body', async () => {
        await mountSwap({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        const line = screen.getByText('Loading wallet…');
        expect(line.closest('[data-form-stack]'), 'inside the FormPage body').not.toBeNull();
    });

    it('lays out the offline notice in the FormPage status region', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        await mountSwap();
        await screen.findByRole('button', { name: /^Give and get network: / });
        const notices = screen.getAllByText('Swapping needs a network connection.');
        expect(notices).toHaveLength(1);
        expect(notices[0].closest('[data-form-status]'), 'inside the FormPage status').not.toBeNull();
    });
});

// ContractStakeForm's wrap() helper is a bare Screen. The load error, the
// loading line, the not-stakeable notice and every done-stage panel reach the
// page through the ListPage each wrap() call passes, and the review and form
// stages through FormPage, so no state draws straight into the Screen box.
describe('ContractStakeForm: every stage renders inside a page template', () => {
    const CHAIN_ID = 'bitcoin-mainnet';
    const ADDRESSES = {
        [CHAIN_ID]: [{
            id: 'stake-a1',
            address: 'bc1qstakerstakerstakerstakerstakerstakers',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        }],
    };

    function listPageClass() {
        const list = render(<ListPage><p>x</p></ListPage>);
        const name = list.container.firstChild.className.split(' ')[0];
        list.unmount();
        return name;
    }

    async function mountStake(overrides = {}) {
        const { ContractStakeForm } = await import('../../../packages/core/src/shared/routes/ContractStakeForm.jsx');
        const { createElement } = await import('react');
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getContractByActionIndex: vi.fn().mockResolvedValue({ row: { cooldown_blocks: 10, slash_destination: null } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            ...overrides,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                if (property in target) return target[property];
                if (typeof property !== 'string') return undefined;
                return vi.fn().mockResolvedValue(null);
            },
        });
        return render(createElement(
            MessagingProvider,
            { shell: 'desktop', messaging: proxy },
            createElement(ContractStakeForm, { walletId: 'w', chainId: CHAIN_ID, contractActionIndex: '7', onBack() {} }),
        ));
    }

    function expectInListPageWithinScreen(element, container) {
        const page = element.closest(`.${CSS.escape(listPageClass())}`);
        expect(page, 'inside ListPage').not.toBeNull();
        expect(page.parentElement, 'ListPage is not the Screen root').not.toBe(container);
        expect(container.contains(page)).toBe(true);
    }

    it('lays out the load error as a ListPage notice', async () => {
        const { container } = await mountStake({
            getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')),
        });
        const status = await screen.findByText('Address store unavailable');
        expectInListPageWithinScreen(status, container);
    });

    it('lays out the loading line inside ListPage', async () => {
        const { container } = await mountStake({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        expectInListPageWithinScreen(screen.getByText('Loading…'), container);
    });

    it('lays out the not-stakeable notice inside ListPage', async () => {
        const { container } = await mountStake({
            getContractByActionIndex: vi.fn().mockResolvedValue({ row: { cooldown_blocks: null } }),
        });
        const notice = await screen.findByText(/is not stakeable/);
        expectInListPageWithinScreen(notice, container);
    });

    it('roots both ResultScreen states and the broadcast panel in ListPage', () => {
        const path = join(coreSrcDir(), 'shared', 'routes', 'ContractStakeForm.jsx');
        const tree = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const roots = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
                const arg = node.arguments[0];
                const name = arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                    ? arg.openingElement.name.name
                    : (arg?.type || 'none');
                roots.push({ line: node.loc.start.line, name, arg });
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
        const holds = (node, test) => {
            if (!node || typeof node !== 'object') return false;
            if (test(node)) return true;
            return Object.values(node).some((value) => (Array.isArray(value)
                ? value.some((item) => holds(item, test))
                : (value && typeof value === 'object' ? holds(value, test) : false)));
        };
        const rootsHolding = (test) => roots.filter(({ arg }) => holds(arg, test)).map(({ name }) => name);

        expect(roots.length).toBeGreaterThanOrEqual(7);
        expect(roots.filter(({ name }) => !['ListPage', 'FormPage'].includes(name))
            .map(({ line, name }) => `ContractStakeForm.jsx:${line} wrap(${name})`)).toEqual([]);
        expect(rootsHolding((node) => node.type === 'JSXOpeningElement'
            && node.name.type === 'JSXIdentifier' && node.name.name === 'ResultScreen')).toEqual(['ListPage', 'ListPage']);
        expect(rootsHolding((node) => node.type === 'JSXText' && node.value.includes('was broadcast'))).toEqual(['ListPage']);
    });
});

// ComposeMessage's wrap() helper is a bare Screen. The load error and the
// loading line reach the page through a FormPage (the error in its status
// region), the sent panel through a FormPage with Done in its action row,
// and the queued and unsigned states through ResultScreen, so no state draws
// straight into the Screen content box.
describe('ComposeMessage: the load error, the loading line and the sent panel render inside FormPage', () => {
    async function mountCompose(overrides = {}) {
        const { MessagingProvider: Provider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
        const { ComposeMessage } = await import('../../../packages/core/src/shared/routes/ComposeMessage.jsx');
        const messaging = {
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            isUnlocked: vi.fn().mockResolvedValue(true),
            ...overrides,
        };
        const proxy = new Proxy(messaging, {
            get(target, property) {
                return property in target ? target[property] : undefined;
            },
        });
        render(
            <Provider shell="desktop" messaging={proxy}>
                <ComposeMessage walletId="w" onBack={() => {}} />
            </Provider>,
        );
    }

    it('lays out the load error in the FormPage status region', async () => {
        await mountCompose({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        const error = await screen.findByText('Address store unavailable');
        expect(error.closest('[data-form-status]'), 'inside the FormPage status region').not.toBeNull();
    });

    it('lays out the loading line inside the FormPage group, not bare in the Screen', async () => {
        await mountCompose({ getAddressesByChain: vi.fn(() => new Promise(() => {})) });
        const loading = await screen.findByText('Loading wallet…');
        const group = screen.getByRole('group', { name: 'New message' });
        expect(group.contains(loading), 'the loading line sits in the FormPage').toBe(true);
    });

    it('passes only FormPage or ResultScreen to every wrap() call', () => {
        const roots = wrapCallRoots('ComposeMessage.jsx');
        expect(roots.length).toBeGreaterThanOrEqual(7);
        const faults = roots
            .filter(({ name }) => !['FormPage', 'ResultScreen'].includes(name))
            .map(({ line, name }) => `ComposeMessage.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });
});
