// @vitest-environment jsdom
import { RegistryProvider, Result } from '@effect-atom/atom-react'
import { ServerInfo } from '@j45/domain'
import { cleanup, render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import { afterEach, describe, expect, it } from 'vitest'

import { ServerInfoCard } from '@/components/server-info-card'
import { ServerRpcClient } from '@/lib/rpc-client'

afterEach(() => {
  cleanup()
})

describe('ServerInfoCard', () => {
  it('renders the release sha from the ServerInfo rpc atom as a quiet footer detail', () => {
    const serverInfo = new ServerInfo({
      sha: 'abc1234',
      version: '0.0.1',
      serverTime: DateTime.unsafeMake('2026-07-08T00:00:00.000Z'),
    })

    render(
      <RegistryProvider
        initialValues={[
          [ServerRpcClient.query('ServerInfo', undefined), Result.success(serverInfo)],
        ]}
      >
        <ServerInfoCard />
      </RegistryProvider>,
    )

    expect(screen.getByTestId('server-info-card')).toBeTruthy()
    expect(screen.getByTestId('server-info-sha').textContent).toBe('abc1234')
    // Footer still surfaces version from the same rpc payload (no longer a
    // Card/dl block — only sha keeps a dedicated testid).
    expect(screen.getByTestId('server-info-card').textContent).toContain('0.0.1')
  })
})
