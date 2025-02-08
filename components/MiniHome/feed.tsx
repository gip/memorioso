import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, MoreHorizontal } from "lucide-react"
import Image from "next/image"
import { Post as PostType } from '@/types'

export const Feed = ({ posts, setPost }: { posts: PostType[], setPost: (post: PostType) => void }) => {

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <article key={post.id} className="px-4 py-3 border-b border-[#1c1c1f]" onClick={() => setPost(post)}>
          <div className="flex items-start gap-3">
            {post.avatar && <Avatar className="w-10 h-10">
              <AvatarImage src={post.avatar} alt={post.author} />
              <AvatarFallback>{post.author[0]}</AvatarFallback>
            </Avatar>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="font-semibold text-[15px]">{post.author}</span>
                  {post.community && (
                    <>
                      <span className="text-gray-500 text-sm">in</span>
                      <Badge
                        variant="secondary"
                        className="bg-transparent border border-[#8b5cf6] text-[#8b5cf6] px-1.5 py-0 text-xs rounded-md"
                      >
                        {post.community}
                      </Badge>
                    </>
                  )}
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
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}