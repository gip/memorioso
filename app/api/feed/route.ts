import { NextResponse } from 'next/server'
import { Post } from '@/types'

const posts: Post[] = [
  {
    id: 1,
    author: "Deep Research Inc",
    community: "AI",
    title: "Dataset about San Francisco",
    content:
      "What neighborhoods have the highest concentration of fine dining restaurants?",
    image: '',
    comments: 42,
    pay: '0.25'
  },
  {
    id: 2,
    author: "nftcollector",
    avatar: "/placeholder.svg?height=40&width=40",
    community: "San Francisco",
    content:
      "Just minted my latest NFT collection! It's a series of digital art pieces inspired by classic literature. Check it out on OpenSea! #NFT #DigitalArt",
    comments: 23,
    pay: '0.50'
  },
  {
    id: 3,
    author: "techanalyst",
    avatar: null,
    community: "tech",
    content:
      "New report suggests AI will create more jobs than it displaces in the next decade. Exciting times ahead for the tech industry! What skills do you think will be most valuable?",
    comments: 67,
    pay: '0.50'
  },
  {
    id: 4,
    author: "techanalyst",
    avatar: "/placeholder.svg?height=40&width=40",
    community: "tech",
    content:
      "New report suggests AI will create more jobs than it displaces in the next decade. Exciting times ahead for the tech industry! What skills do you think will be most valuable?",
    comments: 67,
    pay: '0.50'
  },
  {
    id: 5,
    author: "techanalyst",
    avatar: "/placeholder.svg?height=40&width=40",
    community: "tech",
    content:
      "New report suggests AI will create more jobs than it displaces in the next decade. Exciting times ahead for the tech industry! What skills do you think will be most valuable?",
    comments: 67,
    pay: '0.50'
  },
]

export const GET = async () => {

  return NextResponse.json({ success: true, feed: posts })
}