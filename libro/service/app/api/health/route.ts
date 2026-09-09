export function GET(): Response {
  return Response.json({ success: true, service: 'libro', writesEnabled: process.env.LIBRO_SERVICE_WRITES_ENABLED === '1' })
}
