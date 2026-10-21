import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMessageBubble, parseAnswer, plainText } from './chat-message'
import { ChartCard } from '@/components/ChartCard'
import { FileCard } from '@/components/FileCard'
import type { ChartSpec, ChatMessage, FileSpec } from '@/lib/types'

// jsdom has no ResizeObserver, and recharts measures its container with one.
// A no-op stub is enough: these tests assert on the labels and titles around
// the plot, not on the rendered SVG geometry.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

/**
 * The assistant answers in in-band markers. Copy and export rely on plainText
 * stripping every one of them, and the bubble renders around them — so these
 * cover both the stripping and the fact that the markers never reach the screen
 * as raw text.
 */

const chart: ChartSpec = {
  type: 'bar',
  title: 'Orders by store',
  labels: ['Sanicore', 'Urban Threads'],
  datasets: [{ label: 'Orders', data: [12, 5], format: 'number' }],
}

const file: FileSpec = {
  kind: 'csv',
  title: 'Refused orders',
  description: 'Every refusal in the period.',
  generated_at: '2026-07-20T10:00:00.000Z',
  columns: [{ key: 'city', label: 'City' }],
  rows: [{ city: 'Lahore' }],
}

function message(content: string, role: ChatMessage['role'] = 'assistant'): ChatMessage {
  return { id: 'm1', chat_id: 'c1', role, content, phone: null, created_at: '2026-07-20T10:00:00.000Z' }
}

describe('plainText', () => {
  it('strips citations, charts and files, and drops emphasis', () => {
    const content = [
      '**Two** buyers refused.',
      `[[CHART]]${JSON.stringify(chart)}[[/CHART]]`,
      `[[FILE]]${JSON.stringify(file)}[[/FILE]]`,
      '[[CITES]]search_orders|top_buyers[[/CITES]]',
    ].join('\n\n')

    const text = plainText(content)
    expect(text).toContain('Two buyers refused.')
    expect(text).not.toContain('[[')
    expect(text).not.toContain('*')
    expect(text).not.toContain('"type"')
  })

  it('leaves a normal answer alone', () => {
    expect(plainText('Verdict: LOW RISK')).toBe('Verdict: LOW RISK')
  })

  it('keeps a file that arrives after a chart', () => {
    // Chaining the three parsers used to drop this, because the chart pass
    // trimmed everything from the last chart marker onwards.
    const parsed = parseAnswer(
      ['Both attached.', `[[CHART]]${JSON.stringify(chart)}[[/CHART]]`, `[[FILE]]${JSON.stringify(file)}[[/FILE]]`].join(
        '\n\n',
      ),
    )
    expect(parsed.charts).toHaveLength(1)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0].title).toBe('Refused orders')
    expect(parsed.text).toBe('Both attached.')
  })

  // The assistant emits the three marker kinds in whatever order it likes, so
  // every ordering has to survive. The old chained parsers only handled the
  // ones where CHART came last.
  const MARKERS = {
    chart: `[[CHART]]${JSON.stringify(chart)}[[/CHART]]`,
    file: `[[FILE]]${JSON.stringify(file)}[[/FILE]]`,
    cites: '[[CITES]]weekly_trend|top_buyers[[/CITES]]',
  } as const
  const ORDERS = [
    ['chart', 'file', 'cites'],
    ['chart', 'cites', 'file'],
    ['file', 'chart', 'cites'],
    ['file', 'cites', 'chart'],
    ['cites', 'chart', 'file'],
    ['cites', 'file', 'chart'],
  ] as const

  it.each(ORDERS)('reads every marker when they arrive %s, %s, %s', (a, b, c) => {
    const content = ['Answer body.', MARKERS[a], MARKERS[b], MARKERS[c]].join('\n\n')
    const parsed = parseAnswer(content)
    expect(parsed.charts).toHaveLength(1)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.cites).toEqual(['weekly_trend', 'top_buyers'])
    expect(parsed.text).toBe('Answer body.')
    expect(plainText(content)).toBe('Answer body.')
  })

  it('survives a malformed marker without losing the rest', () => {
    const parsed = parseAnswer(['Body.', '[[CHART]]{not json}[[/CHART]]', MARKERS.file].join('\n\n'))
    expect(parsed.charts).toHaveLength(0)
    expect(parsed.files).toHaveLength(1)
    expect(parsed.text).toBe('Body.')
  })
})

describe('ChatMessageBubble', () => {
  it('renders a bulleted answer with its citation line, and no raw markers', () => {
    const content = ['[Trends] Network snapshot', '- 12 orders', '- 3 refused', '[[CITES]]weekly_trend[[/CITES]]'].join(
      '\n',
    )
    render(<ChatMessageBubble msg={message(content)} />)

    expect(screen.getByText('Network trends')).toBeTruthy()
    expect(screen.getByText('12 orders')).toBeTruthy()
    // The tool name is shown as its plain phrase, not the internal name.
    expect(screen.getByText('weekly trend')).toBeTruthy()
    expect(screen.queryByText(/\[\[/)).toBeNull()
  })

  it('renders a chart and a file the answer carried', () => {
    const content = [
      'Here is the breakdown.',
      `[[CHART]]${JSON.stringify(chart)}[[/CHART]]`,
      `[[FILE]]${JSON.stringify(file)}[[/FILE]]`,
    ].join('\n\n')
    render(<ChatMessageBubble msg={message(content)} />)

    expect(screen.getByText('Orders by store')).toBeTruthy()
    expect(screen.getByText('Refused orders')).toBeTruthy()
    expect(screen.getByText('Lahore')).toBeTruthy()
  })

  it('renders a user message without the report chrome', () => {
    render(<ChatMessageBubble msg={message('Who is risky in Lahore?', 'user')} />)
    expect(screen.getByText('Who is risky in Lahore?')).toBeTruthy()
    expect(screen.getByText('You')).toBeTruthy()
  })
})

describe('ChartCard', () => {
  it('says so when there is nothing to plot', () => {
    render(<ChartCard spec={{ ...chart, labels: [], datasets: [] }} />)
    expect(screen.getByText('No data to chart yet.')).toBeTruthy()
  })

  it('titles every chart it does plot', () => {
    render(<ChartCard spec={chart} />)
    expect(screen.getByText('Orders by store')).toBeTruthy()
  })
})

describe('FileCard', () => {
  it('lists the rows, the formats and the generated time', () => {
    render(<FileCard spec={file} />)
    expect(screen.getByText('Refused orders')).toBeTruthy()
    expect(screen.getByText('City')).toBeTruthy()
    expect(screen.getByText('Lahore')).toBeTruthy()
    // The kind badge and the download button both read "CSV" — one of each.
    expect(screen.getAllByText('CSV')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'CSV' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Excel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeTruthy()
  })

  it('says how many rows are not in the preview', () => {
    const many: FileSpec = {
      ...file,
      rows: Array.from({ length: 12 }, (_, i) => ({ city: `City ${i}` })),
    }
    render(<FileCard spec={many} />)
    expect(screen.getByText('+ 4 more rows in the file')).toBeTruthy()
  })
})
