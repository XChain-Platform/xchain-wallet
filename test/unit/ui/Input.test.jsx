import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef, useEffect } from 'react';
import { Input } from '../../../packages/core/src/ui/Input.jsx';

describe('<Input>', () => {
    it('associates label via htmlFor / id', () => {
        render(<Input label="Email" />);
        const input = screen.getByLabelText('Email');
        expect(input).toBeInTheDocument();
        expect(input.tagName).toBe('INPUT');
    });

    it('renders hint and ties it via aria-describedby', () => {
        render(<Input label="Password" hint="Min 8 chars" />);
        const input = screen.getByLabelText('Password');
        const describedBy = input.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        const hintId = describedBy.split(' ')[0];
        expect(document.getElementById(hintId)).toHaveTextContent('Min 8 chars');
    });

    it('renders error and sets aria-invalid, hiding the hint to avoid noise', () => {
        render(
            <Input label="Email" hint="Use work email" error="Required" />,
        );
        const input = screen.getByLabelText('Email');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent('Required');
        // Hint hidden when error is present (intentional — avoids dual messages).
        expect(screen.queryByText('Use work email')).toBeNull();
    });

    it('omits aria-invalid when there is no error', () => {
        render(<Input label="Name" />);
        expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    });

    it('pass-through value + onChange work end-to-end', () => {
        const onChange = vi.fn();
        render(<Input label="Amount" value="1" onChange={onChange} />);
        const input = screen.getByLabelText('Amount');
        expect(input).toHaveValue('1');
        fireEvent.change(input, { target: { value: '2' } });
        expect(onChange).toHaveBeenCalledOnce();
    });

    it('forwards ref so callers can focus-manage', () => {
        function Harness() {
            const ref = useRef(null);
            useEffect(() => {
                ref.current?.focus();
            }, []);
            return <Input ref={ref} label="Focus me" />;
        }
        render(<Harness />);
        expect(document.activeElement).toBe(screen.getByLabelText('Focus me'));
    });
});
