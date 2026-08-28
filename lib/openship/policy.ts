// Memorioso's machine-readable OpenShip Changes policy, served at /openship/policy.json. The
// portable protocol contract lives at skills/openship/references/openship-changes.md.

/**
 * Paths a submission may write, as `/`-separated prefixes. A trailing `/**` matches the directory
 * and everything under it; anything else is an exact path. A path matching no entry here is
 * rejected even when no protection rule names it: this is an allowlist, and the failure mode of a
 * forgotten rule should be a rejected change rather than a writable one.
 */
const WRITABLE = ['app/**', 'components/**', 'public/**'] as const

/**
 * Never writable, regardless of the allowlist above. `lib/**` covers this file, which is the point:
 * a submission that could edit the policy would only need to pass it once.
 */
const PROTECTED = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.github/**',
  '.vercel/**',
  'AGENTS.md',
  'CLAUDE.md',
  'app/.well-known/**',
  'app/api/**',
  'app/openship/**',
  'components/Openship/**',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'lib/**',
  'libro/**',
  'middleware.js',
  'middleware.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  // The checked-in file list. A submission that could edit it could publish or hide any path.
  'openship.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'postcss.config.js',
  'postcss.config.mjs',
  'postcss.config.cjs',
  'scripts/**',
  // The vendored protocol package is the contract this implementation advertises.
  'skills/openship/**',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.mjs',
  'tailwind.config.cjs',
  'tsconfig.json',
  'types/**',
  'vercel.json',
  'vitest.config.js',
  'vitest.config.ts',
  'vitest.config.mjs',
  'vitest.config.mts',
] as const

/** Lifted out of PROTECTED when OPENSHIP_CHANGES_ALLOW_API is set. */
const API_PREFIX = 'app/api/**'

export const OPENSHIP_LIMITS = {
  filesPerChange: 40,
  bytesPerFile: 256 * 1024,
  bytesPerChange: 1024 * 1024,
  treeGrowthBytes: 2 * 1024 * 1024,
  filesInTree: 2000,
  titleChars: 200,
  intentChars: 4000,
} as const

/** Extensions accepted under public/. An .svg is a script host, so it is scanned as text. */
export const OPENSHIP_MEDIA_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.txt',
] as const

/** Extensions scanned by the content rules. Anything else must be a media file under public/. */
export const OPENSHIP_TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.json', '.md', '.mdx', '.svg',
  '.txt', '.html',
] as const

export type ContentRule = {
  id: string
  /** Human-readable name published in the policy response. */
  rule: string
  pattern: RegExp
  message: string
}

/**
 * The pattern scan. Deliberately blunt and deliberately not the security boundary: it catches
 * accidents and low-effort attempts, and buys nothing against a determined author. Isolation of the
 * build sandbox and of the builds origin is what actually protects the site.
 *
 * Patterns are applied per line with the `g` flag cleared, so none of them may be stateful.
 */
export const OPENSHIP_CONTENT_RULES: readonly ContentRule[] = [
  {
    id: 'dynamic-eval',
    rule: 'Dynamic evaluation',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(\s*(?!['"`])/,
    message: 'Dynamic evaluation is not permitted. Use a literal import specifier.',
  },
  {
    id: 'node-builtins',
    rule: 'Node built-ins',
    pattern:
      /\b(?:from|require\s*\(|import\s*\()\s*['"`](?:node:)?(?:child_process|fs(?:\/promises)?|net|dns|vm|worker_threads|cluster|https?|os|tls|dgram|repl|inspector)['"`]|process\s*\.\s*binding/,
    message: 'Node built-ins are not available to submitted code.',
  },
  {
    id: 'process-env',
    rule: 'Environment access',
    // Allows process.env.NEXT_PUBLIC_* and process.env['NEXT_PUBLIC_…'], denies every other shape
    // including bare `process.env` passed as a value.
    pattern: /process\s*\.\s*env\s*(?!\.\s*NEXT_PUBLIC_[A-Z0-9_]|\[\s*['"`]NEXT_PUBLIC_)/,
    message: 'Only process.env.NEXT_PUBLIC_* may be read.',
  },
  {
    id: 'server-actions',
    rule: 'Server actions',
    pattern: /^\s*['"]use server['"]\s*;?\s*$/,
    message: "'use server' creates an unlisted endpoint. It falls under the API rules.",
  },
  {
    id: 'html-injection',
    rule: 'Raw HTML injection',
    pattern: /dangerouslySetInnerHTML|\.\s*(?:inner|outer)HTML\s*=|insertAdjacentHTML|document\s*\.\s*write\s*\(/,
    message: 'Render text as children rather than injecting raw HTML.',
  },
  {
    id: 'off-origin-subresource',
    rule: 'Off-origin subresources',
    pattern: /<\s*(?:script|iframe|object|embed)\b[^>]*\b(?:src|data)\s*=\s*['"]?(?:https?:)?\/\//i,
    message: 'Subresources must be served from this origin.',
  },
  {
    id: 'off-origin-request',
    rule: 'Off-origin requests',
    pattern:
      /(?:\bfetch\s*\(|new\s+(?:WebSocket|EventSource|XMLHttpRequest)\b[\s\S]{0,40}?\(|sendBeacon\s*\(|\.\s*open\s*\(\s*['"][A-Z]+['"]\s*,)\s*['"`](?:https?:)?\/\//,
    message: 'Requests must be same-origin. Use a relative path.',
  },
  {
    id: 'obfuscation',
    rule: 'Obfuscation',
    pattern: /String\s*\.\s*fromCharCode\s*\(\s*\d|(?:\\x[0-9a-fA-F]{2}){32,}|(?:\\u[0-9a-fA-F]{4}){16,}|\batob\s*\(|Buffer\s*\.\s*from\s*\([^)]*['"]base64['"]/,
    message: 'Encoded or generated source cannot be reviewed, so it cannot ship.',
  },
  {
    id: 'credentials',
    rule: 'Credential shapes',
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"@]+:[^\s'"@]+@/,
    message: 'A submission must never carry a credential.',
  },
]

/** A base64 string literal long enough to hide a payload. Checked separately from the line scan. */
export const OPENSHIP_MAX_BASE64_LITERAL = 4096

export type OpenshipPolicy = {
  openship: string
  capability: 'changes'
  writable: readonly string[]
  protected: readonly string[]
  limits: typeof OPENSHIP_LIMITS
  mediaExtensions: readonly string[]
  contentRules: { id: string; rule: string; message: string }[]
  document: string
  apiWritable: boolean
  enabled: boolean
  payment: { required: boolean; mechanism?: 'x402'; response?: 402 }
}

/**
 * Read once per process rather than per call: this decides what may be written, and a value that
 * can change between the endpoint's answer and the worker's re-check is a way to smuggle a path
 * through the gap.
 */
const apiWritable = process.env.OPENSHIP_CHANGES_ALLOW_API === '1'

export const isApiWritable = (): boolean => apiWritable

export const getProtectedPaths = (): readonly string[] =>
  apiWritable ? PROTECTED.filter((entry) => entry !== API_PREFIX) : PROTECTED

export const getWritablePaths = (): readonly string[] => WRITABLE

export const getOpenshipPolicy = (
  documentUrl: string,
  options: { enabled?: boolean; paymentRequired?: boolean } = {}
): OpenshipPolicy => ({
  openship: '1.0',
  capability: 'changes',
  writable: getWritablePaths(),
  protected: getProtectedPaths(),
  limits: OPENSHIP_LIMITS,
  mediaExtensions: OPENSHIP_MEDIA_EXTENSIONS,
  contentRules: OPENSHIP_CONTENT_RULES.map(({ id, rule, message }) => ({ id, rule, message })),
  document: documentUrl,
  apiWritable,
  enabled: options.enabled ?? false,
  payment: options.paymentRequired
    ? { required: true, mechanism: 'x402', response: 402 }
    : { required: false },
})
