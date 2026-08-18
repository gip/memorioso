import { describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'
import { describeDatabaseFailure, rollbackAndRelease } from './resilience'

function client(query: ReturnType<typeof vi.fn>, release = vi.fn()): PoolClient {
  return { query, release } as unknown as PoolClient
}

describe('database resilience', () => {
  it.each(['40001', '40P01', '55P03', '57014', '08006'])(
    'classifies PostgreSQL %s as retryable',
    (code) => {
      expect(describeDatabaseFailure(Object.assign(new Error('database failure'), { code })))
        .toMatchObject({ retryable: true })
    }
  )

  it('classifies DNS connection failures as retryable and suspect', () => {
    expect(describeDatabaseFailure(Object.assign(new Error('getaddrinfo ENOTFOUND db'), {
      code: 'ENOTFOUND',
    }))).toMatchObject({ retryable: true, destroyConnection: true })
  })

  it('destroys a suspect connection without attempting rollback', async () => {
    const query = vi.fn()
    const release = vi.fn()
    const error = Object.assign(new Error('connection terminated'), { code: '08006' })

    await rollbackAndRelease(client(query, release), error, true)

    expect(query).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith(error)
  })

  it('destroys a connection if rollback itself fails', async () => {
    const rollbackError = new Error('rollback failed')
    const query = vi.fn().mockRejectedValue(rollbackError)
    const release = vi.fn()

    await rollbackAndRelease(client(query, release), new Error('original failure'), true)

    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(release).toHaveBeenCalledWith(rollbackError)
  })

  it('bounds a stalled rollback and destroys the connection', async () => {
    vi.useFakeTimers()
    const query = vi.fn(() => new Promise(() => undefined))
    const release = vi.fn()
    const error = new Error('original failure')
    const pending = rollbackAndRelease(client(query, release), error, true)

    await vi.advanceTimersByTimeAsync(1_000)
    await pending

    expect(release).toHaveBeenCalledWith(error)
    vi.useRealTimers()
  })
})
