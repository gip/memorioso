import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPENSHIP_ENDPOINTS } from '@/lib/openship/manifest'
import Page from './page'

const originalLibroServiceUrl = process.env.LIBRO_SERVICE_URL

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('GET /openship presentation', () => {
  beforeEach(() => {
    delete process.env.LIBRO_SERVICE_URL
  })

  afterEach(() => {
    restoreEnv('LIBRO_SERVICE_URL', originalLibroServiceUrl)
  })

  it('presents the discovery-first protocol contract and every advertised endpoint', () => {
    const markup = renderToStaticMarkup(<Page />)

    expect(markup).toContain('OpenShip page')
    expect(markup).not.toContain('/openship/changes')
    expect(markup).not.toContain('/openship/policy.json')
    expect(markup).toContain('linked discovery and capability JSON documents are authoritative')

    const advertisedLinks = [
      '/.well-known/openship.json',
      OPENSHIP_ENDPOINTS.skill,
      OPENSHIP_ENDPOINTS.manifest,
      OPENSHIP_ENDPOINTS.bundle,
      OPENSHIP_ENDPOINTS.systems,
      OPENSHIP_ENDPOINTS.file,
      OPENSHIP_ENDPOINTS.archive,
      OPENSHIP_ENDPOINTS.instructions,
    ]
    for (const href of advertisedLinks) expect(markup).toContain(`href="${href}"`)
  })
})
