import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const GET = async () => {
  const cookieStore = await cookies()
  const res = cookieStore.get('insecure-session')
  const json = JSON.parse(res?.value || '{}')
  const response = { status: !!json.status, isValid: json.isValid, isHuman: json.isHuman, address: json.address }
  console.log('MER', response)
  return NextResponse.json(response)
}