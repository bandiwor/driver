/**
 * Own icon set: 24×24 grid, 2px stroke, round caps/joins, currentColor.
 * Add icons as path data only — no fills, no external assets.
 */
import type { JSX } from 'preact'

export const ICONS = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5v14M16 5v14',
  wrench: 'M14.5 6.5a4 4 0 0 0-5.3 5L4 16.7 7.3 20l5.2-5.2a4 4 0 0 0 5-5.3l-2.4 2.4-2.6-.6-.6-2.6z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  camera: 'M3 8h3.5L8.5 5h7l2 3H21v11H3zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  eye: 'M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  top: 'M12 3v4M12 17v4M3 12h4M17 12h4M8 8h8v8H8z',
  car: 'M4 15l2-5.5A2 2 0 0 1 7.9 8h8.2a2 2 0 0 1 1.9 1.5L20 15v3h-2.5M4 15v3h2.5M4 15h16M9.5 18h5M7 18a1.5 1.5 0 1 0 0-.01M17 18a1.5 1.5 0 1 0 0-.01',
  wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v6M4.2 16.5l5.2-3M19.8 16.5l-5.2-3',
  spring: 'M12 2v3M12 19v3M7 5h10L7 8.5h10L7 12h10L7 15.5h10L7 19h10',
  engine: 'M4 9h3l2-2h5l2 2h2v3h2v-2h1v6h-1v-2h-2v3h-3l-2 2H9v-2H7v-2H4zM2 11v3',
  tyre: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  brake: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM18 6l2-2',
  body: 'M3 14l3-6h12l3 6v4H3zM3 14h18M8 8l1.5-3h5L16 8',
  volume: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  reset: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevronRight: 'M9.5 5.5L16 12l-6.5 6.5',
  chevronLeft: 'M14.5 5.5L8 12l6.5 6.5',
  keyboard: 'M3 7h18v10H3zM6.5 10.5h1M10.5 10.5h1M14.5 10.5h1M8 14h8',
  bug: 'M9 8V6.5a3 3 0 0 1 6 0V8M7 10h10v4a5 5 0 0 1-10 0zM3 12h4M17 12h4M4.5 7.5L7 9.5M19.5 7.5L17 9.5M4.5 18l2.7-2M19.5 18l-2.7-2',
  exit: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
} as const

export type IconName = keyof typeof ICONS

export interface IconProps {
  name: IconName
  size?: number
  title?: string
  class?: string
}

export function Icon({ name, size = 20, title, class: cls }: IconProps): JSX.Element {
  const filled = name === 'play'
  return (
    <svg
      class={['k-icon', cls].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={ICONS[name]} />
    </svg>
  )
}
