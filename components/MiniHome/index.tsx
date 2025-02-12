'use client'

import { useState, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { BottomNav } from './bottom-navigation'
import { Feed } from './feed'
import { Button } from '../ui/button'
import { Post } from './post'
import { Post as PostType } from '@/types'


export const MiniHome = () => {
  const [tab, setTab] = useState('home')
  const [user, setUser] = useState<{ walletAddress: string; username: string; isHuman: boolean, isVerified: boolean } | null>(null)
  const [isTextVisible, setIsTextVisible] = useState(true)
  const [location, setLocation] = useState<{ success: boolean, city?: string, country?: string } | null>(null)
  const [post, setPost] = useState<PostType | null>(null)
  const [posts, setPosts] = useState<PostType[]>([])
  const [postsToBePaid, setPostsToBePaid] = useState<PostType[]>([])
  const [amount, setAmount] = useState<string | null>(null)
  const [disablePaymentButton, setDisablePaymentButton] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState<{ text: string; color: string } | null>(null)

  useEffect(() => {
    const init = async () => {
      const res = await fetch('/api/mini-auth/session')
      const json = await res.json()
      if(json.status === 'success') {
        setUser(json.user)
      }
    }
    init()
  }, [])

  const fetchPosts = async () => {
    const res = await fetch('/api/feed')
    const data = await res.json()
    const feed = data.feed as PostType[]
    setPosts(feed)
    const postsToBePaid = feed.filter((post) => post.status === 'pending_payment')
    setPostsToBePaid(postsToBePaid)
    if(postsToBePaid.length > 0) {
      const amount = postsToBePaid.reduce((acc, post) => acc + Number(post.pay), 0).toFixed(2)
      setAmount(amount)
    } else {
      setAmount(null)
    }
  }

  useEffect(() => {
    if (user) {
      setIsTextVisible(false)
    }
  }, [user])

  const getLocation = async () => {
    try {      
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported'))
          return
        }
        navigator.geolocation.getCurrentPosition(resolve, reject)
      })
      
      const response = await fetch('/api/geo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // @ts-expect-error - position is a GeolocationPosition object
          latitude: position.coords.latitude,
          // @ts-expect-error - position is a GeolocationPosition object
          longitude: position.coords.longitude
        }),
      })
      
      const { city, country } = await response.json()
      setLocation({ success: true, city, country })
    } catch {
      setLocation({ success: false })
    }
    await fetchPosts()
  }

  const sendPayment = async (address: string, amount: string) => {
    try {
      setDisablePaymentButton(true)
      await fetch('/api/pay/escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, amount, postsToBePaid }),
      })
      setPaymentMessage({ text: 'Payment successful!', color: 'green-500' })
      await fetchPosts()
    } catch {
      setPaymentMessage({ text: 'Payment failed. Please try again.', color: 'red-500' })
    } finally {
      setDisablePaymentButton(false)
    }
  }

  // const requestPermission = useCallback(
  //   async () => {
  //     const requestPermissionPayload: RequestPermissionPayload = {
  //       permission: Permission.Notifications,
  //     }
  //     const payload = await MiniKit.commandsAsync.requestPermission(requestPermissionPayload) as unknown as MiniAppRequestPermissionPayload
  //     if (payload.status === 'success') {
  //       console.log('Permission granted')
  //     } else {
  //       console.log('Permission denied')
  //     }
  //   },
  //   []
  // )

  const signInWithWallet = async () => {
    if (!MiniKit.isInstalled()) {
      return
    }

    const res = await fetch(`/api/mini-auth/nonce`)
    const { nonce } = await res.json()

    const { finalPayload } = await MiniKit.commandsAsync.walletAuth({
      nonce: nonce,
      requestId: '0', // Not sure what this is
      expirationTime: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000),
      notBefore: new Date(new Date().getTime() - 24 * 60 * 60 * 1000),
      statement: 'This is my statement and here is a link https://worldcoin.com/apps',
    })

    // @ts-expect-error - finalPayload is a MiniAppWalletAuthPayload
    const user =await MiniKit.getUserByAddress(finalPayload.address)

    if (finalPayload.status === 'error') {
      return { success: false }
    } else {
      const response = await fetch('/api/mini-auth/complete-siwe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: finalPayload,
          nonce,
          user,
        }),
      })
      const json = await response.json()
      if(json.status === 'success') {
        setUser(json.user)
        if(json.isHuman) {
          await fetchPosts()
        }
      } else {
        setUser(null)
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col pt-2">
      <main className="flex-1 pb-16">
        {tab === 'payments' && <>
          <div className="flex flex-col items-center justify-center h-full mt-10">
            <p className="text-2xl py-6">Amount to be paid</p>
            <p className="text-2xl italic py-6">USDC ${amount || '0.00'}</p>
            {user && (
              <>
                <Button
                  className={`text-3xl rounded-full px-6 py-8 w-4/5 border-2 border-white`}
                  onClick={() => sendPayment(user.walletAddress, amount || '0.00')}
                  disabled={amount === null || disablePaymentButton}
                >
                  {disablePaymentButton ? 'Processing...' : 'Get My Money'}
                </Button>
                {disablePaymentButton && (
                  <div className="w-8 h-8 border-4 border-t-white border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin mt-8" />
                )}
                {paymentMessage && (
                  <div className={`text-xl text-center mt-4 text-${paymentMessage.color}`}>
                    {paymentMessage.text}
                  </div>
                )}
              </>
            )}
          </div>
        </>}
        {tab === 'post' && post&& <Post post={post} setPost={async () => { setPost(null); await fetchPosts(); setTab('messages') }} />}
        {tab === 'messages' && <Feed posts={posts} setPost={(post) => { setPost(post); setTab('post') }} />}
        {tab === 'home' && (
          <div className="flex flex-col items-center justify-center h-full mt-10">
            <p className="text-2xl italic py-6">Memorioso</p>
            <div
              className={`
                overflow-hidden transition-[height,transform] duration-1000 ease-in-out
                ${isTextVisible ? 'h-[120px]' : 'h-0'}
              `}
            >
              <div className={`
                transition-transform duration-1000 ease-in-out
                ${isTextVisible ? 'translate-y-0' : '-translate-y-full'}
              `}>
                <p className="text-md italic text-center">Share your knowledge with the world</p>
                <p className="text-md italic py-6 text-center">Be part of a new economic chain</p>
              </div>
            </div>
            <div className="flex flex-col gap-6 items-center w-full max-w-md">
              <div className="flex flex-col items-center w-full">
                <Button
                  className={`text-3xl rounded-full px-6 py-8 w-4/5 ${user ? 'opacity-50 cursor-not-allowed border-2 border-green-500' : 'border-2 border-white'}`}
                  onClick={signInWithWallet}
                  disabled={!!user}
                >
                  <span className={user ? 'text-green-500' : ''}>
                    {user ? '✅ ' : ''}Sign with wallet
                  </span>
                </Button>
                {!user && (
                  <p className="text-md italic text-center mt-2">To get started, sign in with your wallet</p>
                )}
              </div>

              {user && !user.isHuman && (<>
                <p className="text-md italic text-center mt-2 text-red-500">This app is for verified humans</p>
                <p className="text-md italic text-center mt-2">Please find an Orb to confirm your humanity</p>
              </>)}
              {user && user.isHuman && (<>
                {user.username && (<p className="text-md italic text-center mt-2">Welcome @{user.username}</p>)}
                <div className="flex flex-col items-center w-full">
                  <Button
                    className={`text-3xl rounded-full px-6 py-8 w-4/5 ${location && !location.success ? 'border-2 border-yellow-500' : (location ? 'opacity-50 cursor-not-allowed border-2 border-green-500' : 'border-2 border-white')}`}
                    onClick={getLocation}
                    disabled={!!location}
                  >
                    <span className={user ? (location && !location.success ? 'text-yellow-500' : 'text-green-500') : ''}>
                      {location && !location.success ? '🟡 ' : (location ? '✅ ' : '')}Share location
                    </span>
                  </Button>
                  {!location && (
                    <p className="text-md italic text-center mt-2">Share your location to act as a local expert</p>
                  )}
                  {location && location.success && (
                    <p className="text-md italic text-center mt-6">Location: {location.city}, {location.country}</p>
                  )}
                  {location && !location.success && (
                    <p className="text-md italic text-center mt-6">Could not get location</p>
                  )}
                </div>
                {user && location && (<>
                  <Button
                    className="text-6xl font-bold rounded-full mt-6 w-32 h-32 bg-green-500 hover:bg-green-600 transition-colors"
                    onClick={() => setTab('messages')}
                  >
                    GO
                  </Button>
                  <p className="text-md text-center mt-2">You are all set!<br />Press GO to start sharing your knowledge</p>
                </>)}
              </>)}

            </div>
          </div>
        )}
      </main>
      <div className={`fixed bottom-0 w-full transition-all duration-700 ease-in-out ${
        user && location ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`} >
        <BottomNav tab={tab} setTab={setTab} />
      </div>
    </div>
  )
}
