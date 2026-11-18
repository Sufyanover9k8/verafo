import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { PasswordField } from './password-field'

/** PasswordField is controlled, so the test needs a small stateful wrapper. */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <PasswordField label="Password" value={value} onChange={setValue} autoComplete="new-password" />
  )
}

describe('PasswordField', () => {
  it('starts masked', () => {
    render(<Harness initial="hunter2" />)
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  it('reveals the password and masks it again', async () => {
    const user = userEvent.setup()
    render(<Harness initial="hunter2" />)
    const input = screen.getByLabelText('Password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('keeps the value the user typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('Password')
    await user.type(input, 'correct horse')
    expect(input).toHaveValue('correct horse')
  })

  it('never submits the form when the toggle is clicked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Harness initial="secret" />
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
