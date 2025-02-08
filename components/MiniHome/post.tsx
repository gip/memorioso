import { useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import Image from "next/image"
import { Post as PostType } from '@/types'

export const Post = ({ post, setPost }: { post: PostType, setPost: (post: PostType | null) => void }) => {
  const [answer, setAnswer] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [modalContent, setModalContent] = useState({
    accepted: false,
    reason: ''
  })
  
  const handleSubmit = async () => {
    try {
      const res = await fetch('/api/post', {
        method: 'POST',
        body: JSON.stringify({ postId: post.id, answer })
      })
      const data = await res.json()
      setModalContent({
        accepted: data.accepted,
        reason: data.reason
      })
      setShowModal(true)
    } catch {
      setModalContent({
        accepted: false,
        reason: 'An error occurred while submitting your answer.'
      })
      setShowModal(true)
    }
  }

  const handleModalClose = () => {
    setShowModal(false)
    setPost(null)
  }

  const handleCancel = () => {
    setPost(null)
  }

  return (
    <div className="space-y-4">
      <article className="px-4 py-3 border-b border-[#1c1c1f]">
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
                    {post.community.split(',').map((community, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="bg-transparent border border-[#8b5cf6] text-[#8b5cf6] px-1.5 py-0 text-xs rounded-md"
                      >
                        {community.trim()}
                      </Badge>
                    ))}
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
      
      <div className="px-4 py-3">
        <Textarea
          placeholder="Write your answer here..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="min-h-48 mb-4 text-lg"
        />
        <div className="flex justify-center">
          <Button
            onClick={handleSubmit}
            className="text-3xl rounded-full px-6 py-8 w-4/5 border-2 border-green-500"
            disabled={!answer.trim()} // Disable button if answer is empty
          >
            Submit Answer
          </Button>
        </div>
        <div className="flex justify-center pt-4">
          <Button
            onClick={handleCancel}
            className="text-3xl rounded-full px-6 py-8 w-4/5 border-2 border-red-500"
          >
            Cancel
          </Button>
        </div>
      </div>


      <AlertDialog open={showModal} onOpenChange={setShowModal}>
        <AlertDialogContent className="bg-black border-2 border-[#1c1c1f] max-w-[90%] rounded-xl">
          <AlertDialogHeader className="space-y-3">
            <AlertDialogTitle className={`text-2xl font-bold text-center ${
              modalContent.accepted ? 'text-green-500' : 'text-red-500'
            }`}>
              {modalContent.accepted ? 'Answer Accepted' : 'Answer Not Accepted'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-lg text-center text-gray-300">
              {modalContent.reason}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center">
            <AlertDialogAction 
              onClick={handleModalClose}
              className="text-xl rounded-full px-6 py-4 w-full sm:w-2/3 border-2 border-[#8b5cf6] bg-transparent hover:bg-[#8b5cf6]/20 transition-colors"
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}