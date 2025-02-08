import { NextResponse } from "next/server"

export const POST = async (req: Request) => {
    const { postId, answer } = await req.json()

    return NextResponse.json({ success: true, postId, answer })
  }