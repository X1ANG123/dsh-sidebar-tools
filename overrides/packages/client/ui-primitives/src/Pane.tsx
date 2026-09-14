// The right Sidebar's pane parts: a body that scrolls its own content, the
// header row, the 24px icon control, and the quiet status lines.
//
// They are one module because they are one grammar, and they live in this
// package because two packages need them: `ui-sidebar-files` and the sidebar
// tools panes. A pane tab type composes these instead of restating the panel's
// padding, type scale, and surfaces, so every pane stays identical to the
// others and follows this file when it changes.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Pane.module.css'

/** Data attributes a pane part may carry, for tests and fixtures. */
type PaneDataAttributes = { readonly [attribute: `data-${string}`]: string | number | boolean | undefined }

/**
 * The pane body: one column of the panel, sized by the panel and never a raised
 * card of its own.
 * @param props.scroll - `auto` scrolls the body itself; `none` leaves scrolling to the content it holds.
 * @param props.className - extra class for the call site's own layout intent.
 * @returns the body element.
 */
export function PaneBody({ scroll = 'auto', className, children, ...rest }: {
  scroll?: 'auto' | 'none'
  className?: string | undefined
  children?: ReactNode
} & PaneDataAttributes & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx(css.body, scroll === 'none' && css.noScroll, className)} {...rest}>
      {children}
    </div>
  )
}

/**
 * The pane's header row: a title, its icons, and its controls on one line.
 * @param props.className - extra class for the call site's own layout intent.
 * @returns the header element.
 */
export function PaneHeader({ className, children, ...rest }: {
  className?: string | undefined
  children?: ReactNode
} & PaneDataAttributes & HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(css.header, className)} {...rest}>{children}</div>
}

/**
 * A pane control: the 24px icon button the header rows carry. Unlike `Button`
 * (a capsule sized for labels), this is the square icon control.
 * @param props.label - the control's accessible name, also its native tooltip; required, so it cannot ship unnamed.
 * @param props.title - tooltip override; pass `''` to suppress it when the call site renders its own.
 * @param props.className - extra class for the call site's own layout intent.
 * @returns the button element.
 */
export function PaneIconButton({ label, title = label, className, children, type = 'button', ...rest }: {
  label: string
  title?: string | undefined
  className?: string | undefined
  children?: ReactNode
} & PaneDataAttributes & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'>) {
  return (
    <button type={type} aria-label={label} title={title} className={clsx(css.iconButton, className)} {...rest}>
      {children}
    </button>
  )
}

/**
 * The pane's blocked-state container: what a pane shows when it has no content
 * to draw — no workspace, a failed session, an unavailable shell.
 * @param props.className - extra class for the call site's own layout intent.
 * @returns the status element.
 */
export function PaneStatus({ className, children, ...rest }: {
  className?: string | undefined
  children?: ReactNode
} & PaneDataAttributes & HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(css.status, className)} {...rest}>{children}</div>
}

/**
 * One line of a {@link PaneStatus}: the pane's own words for why it is empty.
 * @param props.className - extra class for the call site's own layout intent.
 * @returns the status line element.
 */
export function PaneStatusLine({ className, children, ...rest }: {
  className?: string | undefined
  children?: ReactNode
} & PaneDataAttributes & HTMLAttributes<HTMLParagraphElement>) {
  return <p className={clsx(css.statusLine, className)} {...rest}>{children}</p>
}
