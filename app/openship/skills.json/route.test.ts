import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { validateSkills } from '@openship/protocol'
import { GET } from './route'

it('publishes a public, valid portable Libro skill with the exact reference bytes', async () => {
  const response = GET()
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  const catalog = validateSkills(await response.json())
  expect(catalog.skills).toHaveLength(1)
  const skill = catalog.skills[0]
  expect(skill.id).toBe('libro')
  const paths = ['SKILL.md', ...readdirSync('libro/skill/references').map(name => `references/${name}`)]
  expect(Object.keys(skill.files).sort()).toEqual(paths.sort())
  for (const path of paths) {
    expect(skill.files[path]).toEqual({ encoding: 'utf-8', content: readFileSync(join('libro/skill', path), 'utf8') })
  }
})
