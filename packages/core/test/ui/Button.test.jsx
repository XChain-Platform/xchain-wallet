import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../src/ui/Button.jsx';

describe('<Button>', () => {
    it('renders children as label', () => {
        render(<Button>Submit</Button>);
        expect(screen.getByRole('button')).toHaveTextContent('Submit');
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Go</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('loading implies disabled and aria-busy', () => {
        render(<Button loading>Signing</Button>);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    it('explicit disabled works independently of loading', () => {
        render(<Button disabled>Stopped</Button>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('type defaults to button (no accidental form submits)', () => {
        render(<Button>Harmless</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('submits via type=submit when set', () => {
        render(<Button type="submit">Confirm</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('forwards arbitrary props like aria-label', () => {
        render(<Button aria-label="Advance">→</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Advance');
    });
});
