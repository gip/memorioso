export async function waitForUserOperation(hash: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`/api/v1/user-operations/${encodeURIComponent(hash)}`, { cache: 'no-store' })
    const body = await response.json().catch(() => null)
    if (response.status !== 202) {
      if (!response.ok) throw new Error(body?.error?.message || 'World wallet receipt lookup failed')
      if (!/^0x[0-9a-f]{64}$/i.test(body?.transactionHash || '')) throw new Error('World wallet returned an invalid transaction hash')
      return body.transactionHash
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('World wallet registration is still pending; retry this signing link shortly')
}
