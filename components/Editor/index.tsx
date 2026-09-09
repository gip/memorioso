'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react'
import NextLink from 'next/link'
import { usePathname } from 'next/navigation'
import { PublicationTimestamp } from '@/components/PublicationTimestamp'

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Button } from '@/components/ui/button'
import { Input } from "@/components/ui/input"
import { Bold, Italic, Strikethrough, Quote, LinkIcon, ImageIcon, List, ListOrdered, ChevronDown, Underline as UnderlineIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import './editor.css'
import type { Author } from '@/lib/db/objects'
import { PUBLICATION_SUBTITLE_MAX_LENGTH } from '@/lib/publication-limits'
import { all, createLowlight } from 'lowlight'

const lowlight = createLowlight(all)

const editorStyles = `
  .ProseMirror {
    > h1 {
      font-size: 2.5em;
      font-weight: 700;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.2;
    }

    > h2 {
      font-size: 2em;
      font-weight: 600;
      margin-top: 1.25em;
      margin-bottom: 0.5em;
      line-height: 1.3;
    }

    > p {
      font-size: 1.125em;
      line-height: 1.7;
      margin-bottom: 1em;
    }

    ul, ol {
      padding-left: 1.5em;
      margin: 1em 0;
    }

    ul {
      list-style-type: disc;
    }

    ul li {
      margin: 0.5em 0;
      line-height: 1.7;
    }

    ul li::marker {
      color: #666;
    }

    ol {
      list-style-type: decimal;
    }

    ol li {
      margin: 0.5em 0;
      line-height: 1.7;
    }

    ol li::marker {
      color: #666;
    }

    li > p {
      margin: 0;
    }
  }
`

export default function Editor({ 
  authors, 
  initialContent, 
  setContent = () => {},
  initialTitle, 
  setTitle = () => {},
  initialSubtitle, 
  setSubtitle = () => {},
  initialAuthorId, 
  setAuthorId = () => {},
  publicationDate,
  editable = true,
  codeBlocks = false
}: { 
  authors: Author[], 
  initialContent: Object | null, 
  setContent?: (content: { html: string }) => void,
  initialTitle: string, 
  setTitle?: (title: string) => void,
  initialSubtitle: string, 
  setSubtitle?: (subtitle: string) => void,
  initialAuthorId: string | null, 
  setAuthorId?: (authorId: string | null) => void,
  publicationDate?: string,
  editable?: boolean,
  codeBlocks?: boolean
}) {
  const pathname = usePathname()
  const findAuthor = useCallback((): Author[] => {
    if (initialAuthorId) {
      const matchedAuthor = authors.find(author => author.id === initialAuthorId)
      if (matchedAuthor) {
        return [matchedAuthor]
      }
    }
    return []
  }, [initialAuthorId, authors])
  const [author, setLocalAuthor] = useState<Author[]>(findAuthor())
  const [title, setLocalTitle] = useState(initialTitle)
  const [subtitle, setLocalSubtitle] = useState(initialSubtitle)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  useEffect(() => {
    setLocalAuthor(findAuthor())
  }, [initialAuthorId, authors, findAuthor])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'underline text-blue-600 hover:text-blue-800'
        },
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: editable ? 'Tell your story...' : '',
      }),
      ...(codeBlocks ? [CodeBlockLowlight.configure({
        lowlight: lowlight,
      })] : []),
    ],
    content: initialContent,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      setContent({ html: editor.getHTML() })
    }
  })

  const toggleFormat = (type: string) => {
    if (!editor) return
    switch (type) {
      case 'bold':
        editor.chain().focus().toggleBold().run()
        break
      case 'italic':
        editor.chain().focus().toggleItalic().run()
        break
      case 'strike':
        editor.chain().focus().toggleStrike().run()
        break
      case 'underline':
        editor.chain().focus().toggleUnderline().run()
        break
      case 'quote':
        editor.chain().focus().toggleBlockquote().run()
        break
      case 'bullet-list':
        editor.chain().focus().toggleBulletList().run()
        break
      case 'ordered-list':
        editor.chain().focus().toggleOrderedList().run()
        break
    }
  }

  const handleStyleChange = (style: string) => {
    if (!editor) return
    switch (style) {
      case 'normal':
        editor.chain().focus().setParagraph().run()
        break
      case 'heading-1':
        editor.chain().focus().toggleHeading({ level: 1 }).run()
        break
      case 'heading-2':
        editor.chain().focus().toggleHeading({ level: 2 }).run()
        break
    }
  }

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target?.result as string
      if (editor && base64) {
        editor.chain().focus().setImage({ src: base64 }).run()
      }
    }
    reader.readAsDataURL(file)
  }

  const addLink = () => {
    if (!editor || !linkUrl) return

    // If there's a selection, add the link to the selected text
    if (editor.state.selection.empty) {
      // If no text is selected, insert the URL as the link text
      editor.chain().focus().setLink({ href: linkUrl }).run()
    } else {
      // If text is selected, make it a link
      editor.chain().focus().setLink({ href: linkUrl }).run()
    }

    setLinkUrl('')
    setIsLinkDialogOpen(false)
  }

  const removeLink = () => {
    if (!editor) return
    editor.chain().focus().unsetLink().run()
  }

  return (
    <div className={editable ? 'pb-16 pt-1 sm:py-4' : 'py-4'}>
      {editable && (
        <div className="-mx-4 mb-5 overflow-x-auto border-y bg-muted/30 px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:mb-6 sm:rounded-lg sm:border sm:px-2">
          <div className="mx-auto w-max">
            <div className="grid grid-cols-[auto_auto] items-center gap-x-1 gap-y-1 sm:flex sm:gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm">
                    Style
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleStyleChange('normal')}>
                    Normal
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStyleChange('heading-1')}>
                    Heading 1
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleStyleChange('heading-2')}>
                    Heading 2
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex items-center gap-0.5 border-l border-r px-1.5 sm:gap-1 sm:px-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('bold')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('bold') ? 'bg-muted' : ''}`}
                >
                  <Bold className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('italic')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('italic') ? 'bg-muted' : ''}`}
                >
                  <Italic className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('underline')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('underline') ? 'bg-muted' : ''}`}
                >
                  <UnderlineIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('strike')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('strike') ? 'bg-muted' : ''}`}
                >
                  <Strikethrough className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('quote')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('blockquote') ? 'bg-muted' : ''}`}
                >
                  <Quote className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5 border-r px-1.5 sm:gap-1 sm:px-2">
                <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('link') ? 'bg-muted' : ''}`}
                    >
                      <LinkIcon className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Add Link</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Input
                          placeholder="Enter URL..."
                          value={linkUrl}
                          onChange={(e) => setLinkUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addLink()
                            }
                          }}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        {editor?.isActive('link') && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              removeLink()
                              setIsLinkDialogOpen(false)
                            }}
                          >
                            Remove Link
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={addLink}
                          disabled={!linkUrl}
                        >
                          Add Link
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="hidden"
                />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0 sm:h-9 sm:w-9"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('bullet-list')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('bulletList') ? 'bg-muted' : ''}`}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('ordered-list')}
                  className={`h-8 w-8 p-0 sm:h-9 sm:w-9 ${editor?.isActive('orderedList') ? 'bg-muted' : ''}`}
                >
                  <ListOrdered className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={editable ? 'space-y-5 px-1 sm:space-y-4 sm:px-0' : 'space-y-4'}>
        <textarea
          value={title}
          onChange={(e) => {
            const newValue = e.target.value.slice(0, 80);
            setLocalTitle(newValue);
            setTitle(newValue);
          }}
          placeholder="Title"
          autoFocus={editable && !initialTitle}
          className="editor-input w-full resize-none overflow-hidden border-none bg-transparent px-0 text-[2rem] leading-[1.1] whitespace-pre-wrap break-words focus:outline-none focus:ring-0 sm:text-4xl"
          readOnly={!editable}
          rows={1}
          style={{
            minHeight: '1.5em',
            height: 'auto'
          }}
          ref={(textarea) => {
            if (textarea) {
              textarea.style.height = '0';
              textarea.style.height = `${textarea.scrollHeight}px`;
            }
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = '0';
            target.style.height = `${target.scrollHeight}px`;
          }}
        />
        
        {editable || subtitle ? (
          <Input
            type="text"
            value={subtitle}
            onChange={(e) => {
              const newValue = e.target.value.slice(0, PUBLICATION_SUBTITLE_MAX_LENGTH);
              setLocalSubtitle(newValue);
              setSubtitle(newValue);
            }}
            placeholder="Add a subtitle..."
            maxLength={PUBLICATION_SUBTITLE_MAX_LENGTH}
            className="editor-input px-0 text-base text-muted-foreground sm:text-xl
                       placeholder:text-muted-foreground/30 break-words"
            readOnly={!editable}
          />
        ) : null}

        {/* While editing, the author is chosen in the publish sheet; show the byline read-only. */}
        {!editable && (
          <div className="flex flex-wrap items-center gap-2 mb-4 sm:mb-8 mt-2 ml-1 italic text-sm">
            {author.map((author, index) => (
              <div key={index} className="flex flex-col items-start gap-1">
                <div className="">
                  <span>By </span> <NextLink href={`/@${author.handle}`} className="text-blurple hover:underline">
                    @{author.handle}
                  </NextLink>
                  <span className="ml-1">/ {author.name}</span>
                  {author.bio && (
                    <span className="ml-1">
                      — {author.bio}
                    </span>
                  )}
                  <span>.</span>
                </div>
                {publicationDate && (
                  <span className="text-gray-500">
                    Signed and published on <strong><PublicationTimestamp date={publicationDate} style="short" /></strong>. Proof of human authorship can be <NextLink href={`${pathname}/proof`} className="text-blurple hover:underline">verified</NextLink> independently.
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="editable min-h-[18rem] text-lg sm:text-xl">
          <style>{editorStyles}</style>
          {editable && editor && (
            <BubbleMenu
              editor={editor}
              tippyOptions={{ duration: 100 }}
              className="flex items-center gap-1 rounded-lg border bg-background p-1 shadow-md"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleFormat('bold')}
                className={`h-9 w-9 p-0 ${editor.isActive('bold') ? 'bg-muted' : ''}`}
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleFormat('italic')}
                className={`h-9 w-9 p-0 ${editor.isActive('italic') ? 'bg-muted' : ''}`}
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleFormat('underline')}
                className={`h-9 w-9 p-0 ${editor.isActive('underline') ? 'bg-muted' : ''}`}
              >
                <UnderlineIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsLinkDialogOpen(true)}
                className={`h-9 w-9 p-0 ${editor.isActive('link') ? 'bg-muted' : ''}`}
              >
                <LinkIcon className="h-4 w-4" />
              </Button>
            </BubbleMenu>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
