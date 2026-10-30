import type { SVGProps } from 'react';

/**
 * "Bộ công cụ": a toolbox with a page sticking out of it. Drawn on the same
 * 24-unit grid, 2-unit stroke and round joins as the lucide icons around it,
 * so it sits in the bar like one of them (size and colour come from CSS).
 */
export function ToolboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
      className={`lucide ${props.className ?? ''}`}
    >
      <path d="M7 10V3.5a.5.5 0 0 1 .5-.5H13l4 4v3" />
      <path d="M13 3v4h4" />
      <rect x="3" y="10" width="18" height="10" rx="2" />
      <path d="M3 14h7.5m3 0H21" />
      <rect x="10.5" y="12.5" width="3" height="3" rx=".5" />
    </svg>
  );
}
