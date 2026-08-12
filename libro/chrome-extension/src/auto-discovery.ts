const DECLARATION_SELECTOR = '.libro-human-signed, script[type="application/libro+json"]'

function nodeMayIntroduceLibro(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement
    return node.textContent?.includes('Libro') === true || parent?.matches(DECLARATION_SELECTOR) === true
  }
  if (!(node instanceof Element)) return false
  if (node.matches('[data-libro-extension-badge], #libro-extension-verifier-style')) return false
  return node.matches(DECLARATION_SELECTOR) || node.querySelector(DECLARATION_SELECTOR) !== null ||
    node.textContent?.includes('Libro') === true
}

/** Cheap gate for SPA declaration insertion/removal; the full scanner remains the authority. */
export function mutationMayAffectLibro(mutations: readonly MutationRecord[]): boolean {
  return mutations.some((mutation) => {
    if (mutation.type === 'characterData') return nodeMayIntroduceLibro(mutation.target)
    return [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]
      .some(nodeMayIntroduceLibro)
  })
}
