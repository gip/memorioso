'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { FcGoogle } from 'react-icons/fc'
import { TbWorldWww } from 'react-icons/tb'
import { useState, useEffect } from 'react'
import { Campaign } from '@/app/api/campaign/route'
function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
      380 - i * 5 * position
    } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
      152 - i * 5 * position
    } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
      684 - i * 5 * position
    } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    color: `rgba(15,23,42,${0.1 + i * 0.03})`,
    width: 0.5 + i * 0.03,
  }))

  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg className="w-full h-full text-slate-950 dark:text-white" viewBox="0 0 696 316" fill="none">
        <title>Background Paths</title>
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={0.1 + path.id * 0.03}
            initial={{ pathLength: 0.3, opacity: 0.6 }}
            animate={{
              pathLength: 1,
              opacity: [0.3, 0.6, 0.3],
              pathOffset: [0, 1, 0],
            }}
            transition={{
              duration: 20 + Math.random() * 10,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
            }}
          />
        ))}
      </svg>
    </div>
  )
}


export const Home = () => {
  const { data: session } = useSession()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  const words = ['Memorioso']

  useEffect(() => {
    const fetchCampaigns = async () => {
      const res = await fetch('/api/campaign')
      const data = await res.json()
      setCampaigns(data)
    }
    if (session) {
      fetchCampaigns()
    }
  }, [session])

  if (session) {
    return (
      <div className="relative min-h-screen w-full flex flex-col items-center justify-start p-8 overflow-hidden bg-white dark:bg-neutral-950">
        <div className="w-full max-w-4xl">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-neutral-900 dark:text-white">Your Campaigns</h2>
            <Button
              variant="outline"
              onClick={() => signOut()}
              className="rounded-xl px-6 py-4 text-base font-semibold backdrop-blur-md 
                       bg-white/95 hover:bg-white/100 dark:bg-black/95 dark:hover:bg-black/100 
                       text-black dark:text-white transition-all duration-300 
                       hover:-translate-y-0.5 border border-black/10 dark:border-white/10
                       hover:shadow-md dark:hover:shadow-neutral-800/50"
            >
              Sign Out
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {campaigns.map((campaign, index) => (
              <div
                key={campaign.id || index}
                className="p-6 rounded-xl border border-black/10 dark:border-white/10 
                         bg-white/95 dark:bg-black/95 backdrop-blur-md
                         hover:shadow-md dark:hover:shadow-neutral-800/50
                         transition-all duration-300"
              >
                <h3 className="text-xl font-semibold mb-2 text-neutral-900 dark:text-white">
                  {campaign.title || 'Untitled Campaign'}
                </h3>
                <p className="text-neutral-600 dark:text-neutral-300">
                  {campaign.description || 'No description available'}
                </p>
                <p className="italic text-neutral-900 dark:text-white mt-2">
                  Author: {campaign.author || 'Unknown'}
                </p>
                <p className="italic text-neutral-900 dark:text-white">
                  Tags: {campaign.tags.length > 0 ? campaign.tags.join(', ') : 'No tags available'}
                </p>
                <p className="italic text-neutral-900 dark:text-white">
                  Budget: USD $1000
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-white dark:bg-neutral-950">
      <div className="absolute inset-0">
        <FloatingPaths position={-8} />
      </div>

      <div className="relative z-10 container mx-auto px-4 md:px-6 text-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 2 }}
          className="max-w-4xl mx-auto"
        >
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-bold mb-8 tracking-tighter">
            {words.map((word, wordIndex) => (
              <span key={wordIndex} className="inline-block mr-4 last:mr-0">
                {word.split("").map((letter, letterIndex) => (
                  <motion.span
                    key={`${wordIndex}-${letterIndex}`}
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{
                      delay: wordIndex * 0.1 + letterIndex * 0.03,
                      type: "spring",
                      stiffness: 150,
                      damping: 25,
                    }}
                    className="inline-block text-transparent bg-clip-text 
                                        bg-gradient-to-r from-neutral-900 to-neutral-700/80 
                                        dark:from-white dark:to-white/80"
                  >
                    {letter}
                  </motion.span>
                ))}
              </span>
            ))}
          </h1>

          <div className="flex space-x-4 justify-center">
            <Button
              variant="outline" onClick={() => signIn('google')}
              className="rounded-xl px-6 py-4 text-base font-semibold backdrop-blur-md 
                         bg-white/95 hover:bg-white/100 dark:bg-black/95 dark:hover:bg-black/100 
                         text-black dark:text-white transition-all duration-300 
                         hover:-translate-y-0.5 border border-black/10 dark:border-white/10
                         hover:shadow-md dark:hover:shadow-neutral-800/50 flex items-center"
            >
              <FcGoogle className="mr-2 h-5 w-5" />
              <span className="opacity-90 group-hover:opacity-100 transition-opacity">Sign in with Google</span>
            </Button>
            <Button
              variant="outline" onClick={() => signIn('worldcoin')}
              className="rounded-xl px-6 py-4 text-base font-semibold backdrop-blur-md 
                         bg-white/95 hover:bg-white/100 dark:bg-black/95 dark:hover:bg-black/100 
                         text-black dark:text-white transition-all duration-300 
                         hover:-translate-y-0.5 border border-black/10 dark:border-white/10
                         hover:shadow-md dark:hover:shadow-neutral-800/50 flex items-center"
            >
              <TbWorldWww className="mr-2 h-5 w-5 text-blue-500" />
              <span className="opacity-90 group-hover:opacity-100 transition-opacity">Sign in with World ID</span>
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}