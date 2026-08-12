// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mutationMayAffectLibro } from './auto-discovery'

function added(node: Node): MutationRecord {
  return { type: 'childList', addedNodes: [node], removedNodes: [] } as unknown as MutationRecord
}

function removed(node: Node): MutationRecord {
  return { type: 'childList', addedNodes: [], removedNodes: [node] } as unknown as MutationRecord
}

describe('late Libro declaration discovery', () => {
  it('detects embeds, manifests, and portable text tags inserted by an SPA', () => {
    const embed = document.createElement('div')
    embed.className = 'libro-human-signed'
    expect(mutationMayAffectLibro([added(embed)])).toBe(true)

    const manifest = document.createElement('script')
    manifest.type = 'application/libro+json'
    expect(mutationMayAffectLibro([added(manifest)])).toBe(true)

    expect(mutationMayAffectLibro([added(document.createTextNode('=== Libro · Signed by a human ==='))])).toBe(true)
  })

  it('ignores ordinary page churn and the extension\'s own decorations', () => {
    const ordinary = document.createElement('div')
    ordinary.textContent = 'Updated stock price'
    const badge = document.createElement('span')
    badge.setAttribute('data-libro-extension-badge', 'block-1')
    expect(mutationMayAffectLibro([added(ordinary), added(badge)])).toBe(false)
  })

  it('detects declaration removal so SPA navigation can clear stale badges', () => {
    const embed = document.createElement('div')
    embed.className = 'libro-human-signed'
    expect(mutationMayAffectLibro([removed(embed)])).toBe(true)
  })
})
