#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillRoot = path.join(repoRoot, 'skills', 'openship')
const provenancePath = path.join(skillRoot, 'UPSTREAM.json')
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
const excluded = new Set(provenance.digestExcludes ?? [])

const files = []
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else {
      const relative = path.relative(skillRoot, absolute).split(path.sep).join('/')
      if (!excluded.has(relative)) files.push(relative)
    }
  }
}

walk(skillRoot)
files.sort()

const records = files
  .map((relative) => {
    const hash = createHash('sha256')
      .update(readFileSync(path.join(skillRoot, relative)))
      .digest('hex')
    return `${relative}\0${hash}\n`
  })
  .join('')
const actual = `sha256:${createHash('sha256').update(records).digest('hex')}`

if (provenance.openship !== '1.0' || provenance.package !== 'openship') {
  throw new Error('The vendored skill provenance does not identify OpenShip v1.')
}
if (actual !== provenance.packageDigest) {
  throw new Error(
    `Vendored OpenShip skill digest mismatch. Expected ${provenance.packageDigest}; got ${actual}.`
  )
}

console.log(`OpenShip skill verified (${files.length} files, ${actual}).`)
