// Local chevron used by ChainPicker so we don't pull in the broader
// icon module just for one shape.

export function ChevronIcon({ open }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}
        >
            <path d="m6 9 6 6 6-6" />
        </svg>
    );
}
