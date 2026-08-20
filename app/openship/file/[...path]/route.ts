import type { NextResponse } from 'next/server'
import { openshipNotFound, openshipResponse } from '@/lib/openship/http'
import { getOpenshipFile, getOpenshipFiles } from '@/lib/openship/manifest'

type Params = Promise<{ path: string[] }>

// Prerender every file in the manifest, so a file fetch is a static asset rather than a function
// invocation. Paths outside the manifest still fall through to the 404 below.
export function generateStaticParams(): { path: string[] }[] {
  return getOpenshipFiles().map((file) => ({ path: file.path.split('/') }))
}

export async function GET(
  _request: Request,
  { params }: { params: Params }
): Promise<NextResponse> {
  const { path } = await params
  // Exact lookup against the manifest. Nothing here touches the filesystem, so a traversal attempt
  // is simply a path that does not exist.
  const filePath = path.map((segment) => decodeURIComponent(segment)).join('/')
  const file = getOpenshipFile(filePath)

  if (!file) {
    return openshipNotFound(`No file at "${filePath}" in this Openship manifest.`)
  }

  return openshipResponse(file.body, file.metadata.mediaType)
}
