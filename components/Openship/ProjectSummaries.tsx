'use client'

import { useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { OpenshipProject } from '@/lib/openship/manifest'

export default function ProjectSummaries({ project }: { project: OpenshipProject }) {
  const [expanded, setExpanded] = useState(false)
  const summaryId = useId()
  const markdownClass = 'prose prose-sm max-w-none break-words dark:prose-invert [&_h1]:text-base [&_h2]:text-base [&_h3]:text-base [&_h1]:leading-6 [&_h2]:leading-6 [&_h3]:leading-6 [&>*:first-child]:mt-0'
  return (
    <div className="space-y-3 text-sm leading-6">
      <p>{project.productDescription}</p>
      <div id={summaryId} className={`${markdownClass}${expanded ? '' : ' line-clamp-5 max-h-[7.5rem] overflow-hidden'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{project.productSummary}</ReactMarkdown>
      </div>
      <button type="button" className="underline underline-offset-4" aria-expanded={expanded} aria-controls={summaryId} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : 'Expand product summary'}
      </button>
      <details className="space-y-3">
        <summary className="cursor-pointer">Technical summary</summary>
        <p>{project.technicalDescription}</p>
        <div className={markdownClass}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{project.technicalSummary}</ReactMarkdown>
        </div>
      </details>
    </div>
  )
}
