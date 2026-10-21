import { createContext, useContext } from 'react'

export interface PaletteApi {
  open: () => void
  close: () => void
}

export const CommandPaletteContext = createContext<PaletteApi | null>(null)

export function useCommandPalette(): PaletteApi {
  const v = useContext(CommandPaletteContext)
  if (!v) throw new Error('useCommandPalette must be used within CommandPaletteProvider')
  return v
}