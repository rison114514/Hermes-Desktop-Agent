import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export type HermesSkillSnapshot = {
  id: string
  name: string
  category: string
  description: string
  enabled: boolean
}

const EXCLUDED_DIRECTORIES = new Set(['.git', '.github', '.hub', '.archive'])

export async function readHermesSkills(skillsRoot: string): Promise<HermesSkillSnapshot[]> {
  const documents: Array<{ skillPath: string; relativeDirectory: string }> = []
  await collectSkillDocuments(skillsRoot, skillsRoot, documents)

  const skills = await Promise.all(documents.map(async ({ skillPath, relativeDirectory }) => {
    const fallbackName = path.basename(relativeDirectory)
    const content = await readFile(skillPath, 'utf8')
    const metadata = parseSkillFrontmatter(content, fallbackName)
    const parts = relativeDirectory.split(path.sep).filter(Boolean)
    return {
      id: parts.join('/'),
      name: metadata.name,
      category: parts.length > 1 ? parts.slice(0, -1).join('/') : '本地',
      description: metadata.description || `来自本机 Hermes skills/${parts.join('/')} 的已安装技能。`,
      enabled: true,
    }
  }))

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

export function createSkillsCatalogPrompt(skills: HermesSkillSnapshot[]) {
  if (skills.length === 0) return ''
  const rows = skills.map((skill) => `- ${skill.name}: ${singleLine(skill.description)}`)
  return [
    '[Hermes skills catalog updated]',
    'The following installed skills are currently available. Use skills_list or skill_view when a task matches one of them:',
    ...rows,
  ].join('\n')
}

export function skillsFingerprint(skills: HermesSkillSnapshot[]) {
  return skills.map((skill) => `${skill.id}\u0000${skill.name}\u0000${skill.description}`).join('\u0001')
}

export function isInstalledSkillInvocation(message: string, skills: HermesSkillSnapshot[]) {
  const match = message.trim().match(/^\/([^\s/]+)/)
  if (!match) return false
  const command = normalizeCommandName(match[1])
  return skills.some((skill) => normalizeCommandName(skill.name) === command)
}

async function collectSkillDocuments(
  skillsRoot: string,
  directory: string,
  result: Array<{ skillPath: string; relativeDirectory: string }>,
) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    result.push({
      skillPath: path.join(directory, 'SKILL.md'),
      relativeDirectory: path.relative(skillsRoot, directory),
    })
    return
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const entryPath = path.join(directory, entry.name)
    const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && await stat(entryPath).then((value) => value.isDirectory()).catch(() => false))
    if (isDirectory) await collectSkillDocuments(skillsRoot, entryPath, result)
  }
}

function parseSkillFrontmatter(content: string, fallbackName: string) {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { name: fallbackName, description: '' }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) return { name: fallbackName, description: '' }

  const lines = normalized.slice(4, end).split('\n')
  let name = fallbackName
  let description = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const nameMatch = line.match(/^name:\s*(.+?)\s*$/)
    if (nameMatch) {
      name = unquote(nameMatch[1]) || fallbackName
      continue
    }

    const descriptionMatch = line.match(/^description:\s*(.*?)\s*$/)
    if (!descriptionMatch) continue
    const value = descriptionMatch[1]
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const block: string[] = []
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        block.push(lines[index + 1].replace(/^\s{1,2}/, ''))
        index += 1
      }
      description = value.startsWith('>') ? block.join(' ') : block.join('\n')
    } else {
      description = unquote(value)
    }
  }

  return { name, description: description.trim() }
}

function unquote(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function singleLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeCommandName(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
