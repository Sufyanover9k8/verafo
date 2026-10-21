import { describe, expect, it } from 'vitest'
import { greetingForName, partForHour } from './greeting'

describe('partForHour', () => {
  it('splits the day into morning / afternoon / evening', () => {
    expect(partForHour(0)).toBe('morning')
    expect(partForHour(9)).toBe('morning')
    expect(partForHour(11)).toBe('morning')
    expect(partForHour(12)).toBe('afternoon')
    expect(partForHour(16)).toBe('afternoon')
    expect(partForHour(17)).toBe('evening')
    expect(partForHour(23)).toBe('evening')
  })
})

describe('greetingForName', () => {
  it('uses the first name when provided', () => {
    expect(greetingForName('Ali Ahmed', 9)).toBe('Good morning, Ali.')
  })

  it('stays impersonal without a name', () => {
    expect(greetingForName('', 9)).toBe('Good morning.')
    expect(greetingForName(undefined, 9)).toBe('Good morning.')
  })

  it('reflects the time of day', () => {
    expect(greetingForName('Ali', 8)).toBe('Good morning, Ali.')
    expect(greetingForName('Ali', 14)).toBe('Good afternoon, Ali.')
    expect(greetingForName('Ali', 20)).toBe('Good evening, Ali.')
  })
})