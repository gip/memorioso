import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPENSHIP_ENDPOINTS } from '@/lib/openship/manifest'
import Page from './page'

const originalChangesEnabled = process.env.OPENSHIP_CHANGES_ENABLED
const originalBuildsDomain = process.env.OPENSHIP_BUILDS_DOMAIN
const originalLibroServiceUrl = process.env.LIBRO_SERVICE_URL

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('GET /openship presentation', () => {
  beforeEach(() => {
    delete process.env.OPENSHIP_CHANGES_ENABLED
    delete process.env.OPENSHIP_BUILDS_DOMAIN
    delete process.env.LIBRO_SERVICE_URL
  })

  afterEach(() => {
    restoreEnv('OPENSHIP_CHANGES_ENABLED', originalChangesEnabled)
    restoreEnv('OPENSHIP_BUILDS_DOMAIN', originalBuildsDomain)
    restoreEnv('LIBRO_SERVICE_URL', originalLibroServiceUrl)
  })

  it('presents the discovery-first protocol contract and every advertised endpoint', () => {
    const markup = renderToStaticMarkup(<Page />)

    expect(markup).toContain('OpenShip page')
    expect(markup).toContain('linked discovery and capability JSON documents are authoritative')
    expect(markup).toContain('does not currently accept submissions')
    expect(markup).toContain('never a production deployment')

    const advertisedLinks = [
      '/.well-known/openship.json',
      OPENSHIP_ENDPOINTS.skill,
      OPENSHIP_ENDPOINTS.manifest,
      OPENSHIP_ENDPOINTS.bundle,
      OPENSHIP_ENDPOINTS.systems,
      OPENSHIP_ENDPOINTS.file,
      OPENSHIP_ENDPOINTS.archive,
      OPENSHIP_ENDPOINTS.instructions,
      OPENSHIP_ENDPOINTS.policy,
      OPENSHIP_ENDPOINTS.changes,
      OPENSHIP_ENDPOINTS.changeStatus,
    ]
    for (const href of advertisedLinks) expect(markup).toContain(`href="${href}"`)
  })
})
