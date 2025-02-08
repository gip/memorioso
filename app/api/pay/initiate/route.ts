import { NextResponse } from 'next/server'

export async function POST() {
	const uuid = crypto.randomUUID().replace(/-/g, '')
	// TODO: persist uuid
	return NextResponse.json({ id: uuid })
}