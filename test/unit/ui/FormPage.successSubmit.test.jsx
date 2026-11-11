// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

afterEach(cleanup);

function renderActions(actions, demoGuard) {
    render(
        <FormPage label="Action form" actions={actions} demoGuard={demoGuard}>
            <input aria-label="Field" />
        </FormPage>,
    );
}

describe('FormPage submit action treatment', () => {
    it('makes a default disabled submit a success action', () => {
        renderActions(<Button type="submit" disabled>Continue</Button>);

        const submit = screen.getByRole('button', { name: 'Continue' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(submit).toBeDisabled();
    });

    it('makes an explicit primary submit a success action', () => {
        renderActions(<Button type="submit" variant="primary">Import</Button>);

        expect(screen.getByRole('button', { name: 'Import' })).toHaveClass(buttonStyles.success);
    });

    it('keeps a demo-guarded submit disabled and successful', () => {
        renderActions(
            <Button type="submit">Broadcast</Button>,
            { blocked: true, note: null, dialog: null },
        );

        const submit = screen.getByRole('button', { name: 'Broadcast' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(submit).toBeDisabled();
    });

    it('reaches submits nested in fragments and wrappers', () => {
        renderActions(
            <>
                <span><Button type="submit">Next</Button></span>
                <><Button type="submit">Unlock</Button></>
            </>,
        );

        expect(screen.getByRole('button', { name: 'Next' })).toHaveClass(buttonStyles.success);
        expect(screen.getByRole('button', { name: 'Unlock' })).toHaveClass(buttonStyles.success);
    });

    it('preserves explicit secondary and danger submits', () => {
        renderActions(
            <>
                <Button type="submit" variant="secondary">Back</Button>
                <Button type="submit" variant="danger">Delete</Button>
            </>,
        );

        expect(screen.getByRole('button', { name: 'Back' })).toHaveClass(buttonStyles.secondary);
        expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(buttonStyles.danger);
    });

    it('preserves a non-submit button child and its automatic icon beside the submit', () => {
        renderActions([
            <Button key="cancel" type="button">Cancel</Button>,
            <Button key="submit" type="submit">Continue</Button>,
        ]);

        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel).toHaveClass(buttonStyles.primary);
        expect(cancel).not.toHaveClass(buttonStyles.success);
        expect(cancel.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass(buttonStyles.success);
    });

    it('makes one icon-bearing result action successful without promoting its companion action', () => {
        renderActions(
            <>
                <Button type="button" variant="secondary">Start another</Button>
                <Button type="button" onClick={() => {}}>Done</Button>
            </>,
        );

        const companion = screen.getByRole('button', { name: 'Start another' });
        const done = screen.getByRole('button', { name: 'Done' });
        expect(companion).toHaveClass(buttonStyles.secondary);
        expect(companion).not.toHaveClass(buttonStyles.success);
        expect(done).toHaveClass(buttonStyles.success);
        expect(done.querySelector('svg')).toBeInTheDocument();
        expect(screen.getAllByRole('button').filter((button) => button.classList.contains(buttonStyles.success))).toHaveLength(1);
    });

    it('makes the last primary action of a submit-less row (a result or step screen) the success action', () => {
        renderActions(<><Button type="button" variant="ghost">Close</Button><Button type="button">Back</Button><Button type="button">Done</Button></>);

        const done = screen.getByRole('button', { name: 'Done' });
        expect(done).toHaveClass(buttonStyles.success);
        expect(screen.getByRole('button', { name: 'Back' })).toHaveClass(buttonStyles.primary);
        expect(screen.getByRole('button', { name: 'Close' })).not.toHaveClass(buttonStyles.success);
        expect(screen.getAllByRole('button').filter((button) => button.classList.contains(buttonStyles.success))).toHaveLength(1);
    });

    it('leaves a submit-less row alone when it already has a success action', () => {
        renderActions(<><Button type="button" variant="success">Create</Button><Button type="button">Import</Button><Button type="button">Pair</Button></>);

        expect(screen.getByRole('button', { name: 'Create' })).toHaveClass(buttonStyles.success);
        expect(screen.getByRole('button', { name: 'Import' })).toHaveClass(buttonStyles.primary);
        expect(screen.getByRole('button', { name: 'Pair' })).toHaveClass(buttonStyles.primary);
        expect(screen.getAllByRole('button').filter((button) => button.classList.contains(buttonStyles.success))).toHaveLength(1);
    });

    it('keeps every primary action in a choice row primary', () => {
        render(
            <FormPage
                label="Choose an action"
                choiceActions
                actions={(
                    <>
                        <Button type="button">Create</Button>
                        <Button type="button">Pair</Button>
                    </>
                )}
            />,
        );

        const create = screen.getByRole('button', { name: 'Create' });
        const pair = screen.getByRole('button', { name: 'Pair' });
        expect(create).toHaveClass(buttonStyles.primary);
        expect(create).not.toHaveClass(buttonStyles.success);
        expect(pair).toHaveClass(buttonStyles.primary);
        expect(pair).not.toHaveClass(buttonStyles.success);
    });
});
