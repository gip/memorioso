export function GET(): Response {
  return Response.json({ service: 'Libro', mcp: '/mcp', api: '/api/v1' })
}
