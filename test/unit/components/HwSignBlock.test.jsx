// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HwSignBlock } from '../../../packages/core/src/shared/components/HwSignBlock.jsx';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const baseProps = {
    signerKind: 'ledger',
    signerName: 'Test Ledger',
    path: "m/84'/0'/0'/0/0",
    address: 'bc1qexample',
    chainId: 'bitcoin-mainnet',
};

describe('HwSignBlock device instructions', () => {
    it('shows each signing step after the mocked transport reports ready', async () => {
        const transport = vi.fn().mockResolvedValue({ status: 'available' });
        render(<HwSignBlock {...baseProps} getStatus={transport} />);

        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent('1. Select the sign button below.');
        expect(status).toHaveTextContent('2. Review every detail on your device.');
        expect(status).toHaveTextContent('3. Approve on the device only if everything matches.');
        expect(status).toHaveTextContent('To cancel, reject on the device; nothing will be signed.');
        expect(transport).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet' });
    });

    it('treats an explicit device rejection as cancellation, not disconnection', async () => {
        const rejection = Object.assign(new Error('request rejected'), {
            name: 'UserRejectedError',
        });
        const transport = vi.fn().mockRejectedValue(rejection);
        render(<HwSignBlock {...baseProps} getStatus={transport} />);

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveAttribute('data-status', 'cancelled');
        });
        expect(screen.getByRole('status')).toHaveTextContent(
            'Signing was cancelled on your device. Nothing was signed.',
        );
        expect(screen.queryByText(/Device not detected/i)).not.toBeInTheDocument();
    });

    it('hides transport errors and lets the user retry the status check', async () => {
        const transport = vi.fn()
            .mockRejectedValueOnce(new Error('usb://ledger-7 transport exploded'))
            .mockResolvedValueOnce({ status: 'available' });
        const { container } = render(<HwSignBlock {...baseProps} getStatus={transport} />);

        await waitFor(() => {
            expect(container.querySelector('[data-status="disconnected"]')).toBeTruthy();
        });
        expect(screen.getByRole('status')).toHaveTextContent(
            'Device not detected. Check its connection, unlock it, and try again.',
        );
        expect(screen.getByRole('status')).not.toHaveTextContent('usb://ledger-7');

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => {
            expect(container.querySelector('[data-status="available"]')).toBeTruthy();
        });
        expect(transport).toHaveBeenCalledTimes(2);
    });

    it('keeps the async status area empty when no status reader is available', () => {
        const { container } = render(<HwSignBlock {...baseProps} getStatus={null} />);

        expect(container.querySelector('[data-status]')).toBeNull();
    });

    it('notifies its parent only when the committed status snapshot changes', () => {
        const onStatusChange = vi.fn();
        const { rerender } = render(
            <HwSignBlock {...baseProps} getStatus={null} onStatusChange={onStatusChange} />,
        );

        expect(onStatusChange).toHaveBeenCalledTimes(1);
        expect(onStatusChange).toHaveBeenLastCalledWith({
            status: 'idle',
            detail: null,
            refresh: expect.any(Function),
        });

        rerender(
            <HwSignBlock {...baseProps} getStatus={null} onStatusChange={onStatusChange} />,
        );
        expect(onStatusChange).toHaveBeenCalledTimes(1);
    });

    it('ignores a status result from the previous chain', async () => {
        vi.useFakeTimers();
        let resolveBitcoin;
        let resolveLitecoin;
        const readStatus = vi.fn(({ chainId }) => new Promise((resolve) => {
            if (chainId === 'bitcoin-mainnet') resolveBitcoin = resolve;
            if (chainId === 'litecoin-mainnet') resolveLitecoin = resolve;
        }));
        const { container, rerender } = render(
            <HwSignBlock {...baseProps} getStatus={(options) => readStatus(options)} />,
        );
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(readStatus).toHaveBeenCalledTimes(1);

        rerender(
            <HwSignBlock
                {...baseProps}
                chainId="litecoin-mainnet"
                getStatus={(options) => readStatus(options)}
            />,
        );
        expect(container.querySelector('[data-status]')).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(readStatus).toHaveBeenCalledTimes(2);

        await act(async () => {
            resolveLitecoin({ status: 'available', detail: 'litecoin ready' });
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(container.querySelector('[data-status="available"]')).toBeTruthy();

        await act(async () => {
            resolveBitcoin({ status: 'disconnected', detail: 'stale bitcoin result' });
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(container.querySelector('[data-status="available"]')).toBeTruthy();
        expect(screen.queryByText(/Device not detected/)).toBeNull();
        expect(vi.getTimerCount()).toBe(1);
    });
});
