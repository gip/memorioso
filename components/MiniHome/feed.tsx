import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, MoreHorizontal } from "lucide-react"
import Image from "next/image"
import { Post as PostType } from '@/types'
import { useState } from 'react'

export const Feed = ({ posts, setPost }: { posts: PostType[], setPost: (post: PostType) => void }) => {
  const [filter, setFilter] = useState<string>('Active')

  const statusMap = {
    'Active': 'pending_reply',
    'To Be Paid': 'pending_payment',
    'Paid': 'paid',
    'Rejected': 'rejected'
  }

  const filteredPosts = posts.filter(post => 
    filter === 'All' ? true : post.status === statusMap[filter as keyof typeof statusMap]
  )

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-3 px-4 mb-4 mt-4">
        {['All', 'Active', 'To Be Paid', 'Paid', 'Rejected'].map((status) => (
          <Badge
            key={status}
            variant="secondary"
            className={`cursor-pointer hover:opacity-80 text-[14px] py-0 px-2 ${
              filter === status 
                ? 'bg-yellow-500 text-black' 
                : 'bg-transparent border border-yellow-500 text-yellow-500'
            }`}
            onClick={() => setFilter(status)}
          >
            {status}
          </Badge>
        ))}
      </div>
      {filteredPosts.map((post) => (
        <article 
          key={post.id} 
          className={`px-4 py-3 border-b border-[#1c1c1f] ${post.status === 'pending_reply' ? 'cursor-pointer hover:bg-gray-900' : 'cursor-not-allowed'}`} 
          onClick={() => post.status === 'pending_reply' ? setPost(post) : null}
        >
          <div className="flex items-start gap-3">
            {post.avatar && <Avatar className="w-10 h-10">
              <AvatarImage src={post.avatar} alt={post.author} />
              <AvatarFallback>{post.author[0]}</AvatarFallback>
            </Avatar>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-[15px]">{post.author}</span>
                  {post.community && (<>
                    <span className="text-gray-500 text-sm">in</span>
                    {post.community.split(',').map((community, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="bg-transparent border border-[#8b5cf6] text-[#8b5cf6] px-1.5 py-0 text-xs rounded-md"
                      >
                        {community.trim()}
                      </Badge>
                    ))}
                  </>)}
                </div>
                <button className="text-gray-500">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
              <p className="mt-1 text-[15px] whitespace-pre-wrap font-bold italic">{post.title}</p>
              <p className="mt-1 text-[15px] whitespace-pre-wrap">{post.content}</p>
              {post.image && (
                <div className="mt-2 rounded-lg overflow-hidden bg-[#1c1c1f]">
                  <Image
                    src={post.image || "/placeholder.svg"}
                    alt="Post image"
                    width={400}
                    height={200}
                    className="w-full object-cover"
                  />
                </div>
              )}
              <div className="flex items-center gap-6 mt-3 text-[#6b7280]">
                <button className="flex items-center gap-1.5">
                  <MessageSquare className="w-[18px] h-[18px]" />
                  <span className="text-sm">{post.comments}</span>
                </button>
                <button className="flex items-center gap-1.5">
                  <span className="text-sm">USDC {post.pay}</span>
                </button>
                <Badge 
                  variant="secondary" 
                  className={`bg-transparent border px-1.5 py-0 text-xs rounded-md ${post.status === 'pending_reply' ? 'border-green-500 text-green-500' : 
                    post.status === 'pending_payment' ? 'border-yellow-500 text-yellow-500' : 
                    post.status === 'paid' ? 'border-green-500 text-green-500' : 
                    post.status === 'rejected' ? 'border-red-500 text-red-500' : ''}`}
                >
                  {post.status === 'pending_reply' ? 'Active' : 
                    post.status === 'pending_payment' ? 'To Be Paid' : 
                    post.status === 'paid' ? 'Paid' : 
                    post.status === 'rejected' ? 'Rejected' : ''}
                </Badge>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}