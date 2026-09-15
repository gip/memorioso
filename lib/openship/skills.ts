import { computeSkillDigest, validateSkills, type SharedSkill, type SkillsDocument } from '@openship/protocol'

export const LIBRO_SKILLS_DESCRIPTION =
  'Learn to build with Libro MCP: connect, authenticate, publish as a human or authorized agent, and verify publications.'

// Compose both transports from the published snapshot, preserving the portable folder bytes.
export function composeLibroSkills(snapshotFiles: SharedSkill['files']): SkillsDocument {
  const prefix = 'libro/skill/'
  if (!snapshotFiles[`${prefix}SKILL.md`]) {
    return { openship: '1.0', capability: 'skills', skills: [] }
  }
  const files = Object.fromEntries(Object.entries(snapshotFiles)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, entry]) => [path.slice(prefix.length), entry]))
  for (const path of ['references/mcp.md', 'references/protocol.md', 'references/embed.md']) {
    if (!files[path]) throw new Error(`Libro skill is missing ${path}`)
  }
  return validateSkills({
    openship: '1.0',
    capability: 'skills',
    skills: [{
      id: 'libro',
      name: 'Build with Libro MCP',
      description: LIBRO_SKILLS_DESCRIPTION,
      version: '1.0.0',
      purposes: ['understand', 'build', 'reuse'],
      digest: computeSkillDigest(files),
      files,
    }],
  })
}
