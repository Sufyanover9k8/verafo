import { createContext, useContext } from 'react'

/**
 * A counter that bumps whenever the app shell's layout changes (sidebar
 * collapse/expand, mobile drawer toggle). Chart components subscribe so they
 * can replay their draw-in animation even when the layout change does not
 * alter the content width (e.g. wide screens capped by --v-content-max).
 */
export const LayoutTickContext = createContext(0)

export function useLayoutTick(): number {
  return useContext(LayoutTickContext)
}