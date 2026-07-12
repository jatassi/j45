// @vitest-environment jsdom
import { Result } from '@effect-atom/atom-react'
import { cleanup, render, screen } from '@testing-library/react'
import { Cause } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { QueryBoundary } from '@/components/query-boundary'

afterEach(() => {
  cleanup()
})

describe('QueryBoundary', () => {
  it('renders Skeleton while the result is Initial', () => {
    render(
      <QueryBoundary
        result={Result.initial()}
        isEmpty={(items: readonly string[]) => items.length === 0}
      >
        {(items) => (
          <ul data-testid="list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </QueryBoundary>,
    )

    expect(screen.getByTestId('query-boundary-loading')).toBeTruthy()
    expect(screen.queryByTestId('list')).toBeNull()
  })

  it('renders Empty with a CTA when success is empty', () => {
    render(
      <QueryBoundary
        result={Result.success([] as readonly string[])}
        isEmpty={(items) => items.length === 0}
        emptyTitle="No workouts yet"
        emptyDescription="Create your first workout to get started."
        emptyAction={<button type="button">Create workout</button>}
      >
        {(items) => (
          <ul data-testid="list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </QueryBoundary>,
    )

    expect(screen.getByTestId('query-boundary-empty')).toBeTruthy()
    expect(screen.getByText('No workouts yet')).toBeTruthy()
    expect(screen.getByText('Create your first workout to get started.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create workout' })).toBeTruthy()
    expect(screen.queryByTestId('list')).toBeNull()
  })

  it('renders children on non-empty success', () => {
    render(
      <QueryBoundary
        result={Result.success(['Push', 'Pull'] as readonly string[])}
        isEmpty={(items) => items.length === 0}
      >
        {(items) => (
          <ul data-testid="list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </QueryBoundary>,
    )

    expect(screen.getByTestId('list')).toBeTruthy()
    expect(screen.getByText('Push')).toBeTruthy()
    expect(screen.getByText('Pull')).toBeTruthy()
    expect(screen.queryByTestId('query-boundary-empty')).toBeNull()
  })

  it('renders Alert with Retry on failure', () => {
    const onRetry = vi.fn()

    render(
      <QueryBoundary
        result={Result.failure(Cause.fail('boom'))}
        isEmpty={() => false}
        errorTitle="Failed to load"
        onRetry={onRetry}
      >
        {() => <div data-testid="list" />}
      </QueryBoundary>,
    )

    expect(screen.getByTestId('query-boundary-error')).toBeTruthy()
    expect(screen.getByText('Failed to load')).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'Retry' })
    retry.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
