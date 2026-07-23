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
    <div className="max-w-4xl mx-auto px-4 py-6 pt-4">
      {editable && (
        <div className="-mx-4 px-2 mb-3 border-b flex justify-center overflow-x-auto">
          <div className="flex items-center justify-between gap-2 py-1.5">
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 px-3 text-sm">
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

              <div className="flex items-center gap-1 border-l border-r px-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('bold')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('bold') ? 'bg-muted' : ''}`}
                >
                  <Bold className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('italic')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('italic') ? 'bg-muted' : ''}`}
                >
                  <Italic className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('underline')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('underline') ? 'bg-muted' : ''}`}
                >
                  <UnderlineIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('strike')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('strike') ? 'bg-muted' : ''}`}
                >
                  <Strikethrough className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('quote')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('blockquote') ? 'bg-muted' : ''}`}
                >
                  <Quote className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-1 border-r px-2">
                <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className={`h-9 w-9 p-0 ${editor?.isActive('link') ? 'bg-muted' : ''}`}
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
                  className="h-9 w-9 p-0"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('bullet-list')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('bulletList') ? 'bg-muted' : ''}`}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleFormat('ordered-list')}
                  className={`h-9 w-9 p-0 ${editor?.isActive('orderedList') ? 'bg-muted' : ''}`}
                >
                  <ListOrdered className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <textarea
          value={title}
          onChange={(e) => {
            const newValue = e.target.value.slice(0, 80);
            setLocalTitle(newValue);
            setTitle(newValue);
          }}
          placeholder="Title"
          autoFocus={editable && !initialTitle}
          className="editor-input text-4xl sm:text-4xl md:text-4xl px-0 w-full resize-none overflow-hidden border-none bg-transparent focus:outline-none focus:ring-0 whitespace-pre-wrap break-words"
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
              const newValue = e.target.value.slice(0, 80);
              setLocalSubtitle(newValue);
              setSubtitle(newValue);
            }}
            placeholder="Add a subtitle..."
            className="editor-input text-lg sm:text-xl text-muted-foreground px-0 
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
                  <span>By </span> <NextLink href={`/a/${author.handle}`} className="text-blurple hover:underline">
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

        <div className="editable text-xl">
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
