import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RouteBoundary, isChunkLoadError } from './route-boundary'

/*
 * The merchant's report was "switching pages leaves a blank screen". Nothing
 * caught the error, so the whole tree unmounted. These tests keep the recovery
 * path honest: a crash must always render something with a way out.
 */

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Pretend a reload already happened: keeps jsdom from attempting navigation.
  sessionStorage.setItem('verafo.route.reloadedAt', String(Date.now()))
})

describe('route boundary', () => {
  it('renders a recovery card instead of a blank screen', () => {
    render(
      <MemoryRouter>
        <RouteBoundary title="Orders">
          <Boom message="kaboom" />
        </RouteBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Orders didn’t load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByText(/kaboom/)).toBeInTheDocument()
  })

  it('explains a missing chunk as an update, not a bug', () => {
    render(
      <MemoryRouter>
        <RouteBoundary>
          <Boom message="Failed to fetch dynamically imported module: https://www.verafo.com/assets/Orders-abc123.js" />
        </RouteBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByText(/Verafo was updated while this tab was open/)).toBeInTheDocument()
  })

  it('recognises a chunk failure from the browser message alone', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: x'))).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of null (reading status)'))).toBe(false)
    expect(isChunkLoadError('some string')).toBe(false)
  })

  it('renders its children while nothing is wrong', () => {
    render(
      <MemoryRouter>
        <RouteBoundary>
          <p>Orders table</p>
        </RouteBoundary>
      </MemoryRouter>,
    )
    expect(screen.getByText('Orders table')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
