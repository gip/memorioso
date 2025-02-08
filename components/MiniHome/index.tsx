'use client'

import { useState, useEffect } from 'react'
import { MiniKit, PayCommandInput, Tokens, tokenToDecimals } from '@worldcoin/minikit-js'
import { BottomNav } from './bottom-navigation'
import { Feed } from './feed'
import { Button } from '../ui/button'
import { Post } from './post'
import { Post as PostType } from '@/types'
export const MiniHome = () => {
  const [tab, setTab] = useState('home')
  const [walletAuth, setWalletAuth] = useState<{ address: string } | null>(null)
  const [isTextVisible, setIsTextVisible] = useState(true)
  const [location, setLocation] = useState<{ success: boolean, city?: string, country?: string } | null>(null)
  const [post, setPost] = useState<PostType | null>(null)
  const [posts, setPosts] = useState<PostType[]>([])
  const [postsToBePaid, setPostsToBePaid] = useState<PostType[]>([])
  const [amount, setAmount] = useState<number>(0)


  const fetchPosts = async () => {
    const res = await fetch('/api/feed')
    const data = await res.json()
    const feed = data.feed as PostType[]
    setPosts(feed)
    const postsToBePaid = feed.filter((post) => post.status === 'pending_payment')
    setPostsToBePaid(postsToBePaid)
    setAmount(postsToBePaid.reduce((acc, post) => acc + Number(post.pay), 0))
  }

  useEffect(() => {
    if (walletAuth) {
      setIsTextVisible(false)
    }
  }, [walletAuth])

  const getLocation = async () => {
    try {      
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported'))
          return
        }
        navigator.geolocation.getCurrentPosition(resolve, reject);
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
      await fetchPosts()
    } catch {
      setLocation({ success: false });
    }
  }

  const sendPayment = async (address: string, amount: number) => {
    const res = await fetch('/api/pay/initiate', {
      method: 'POST',
    })
    const { id } = await res.json()

    const payload: PayCommandInput = {
      reference: id,
      to: address,
      tokens: [
        {
          symbol: Tokens.USDCE,
          token_amount: tokenToDecimals(amount, Tokens.USDCE).toString(),
        }
      ],
      description: 'Memorioso payment',
    }

    if (!MiniKit.isInstalled()) {
      return
    }

    const { finalPayload } = await MiniKit.commandsAsync.pay(payload)
    await fetch(`/api/debug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload),
    })
    if (finalPayload.status == 'success') {
      const res = await fetch(`/api/pay/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: finalPayload, postsToBePaid }),
      })
      const payment = await res.json()
      await fetch(`/api/debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payment),
      })
      if (payment.success) {
        await fetchPosts()
      }
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
        }),
      })
      const json = await response.json()
      setWalletAuth(json)
      await fetchPosts()
    }
  }

  return (
    <div className="min-h-screen flex flex-col pt-2">
      <main className="flex-1 pb-16">
        {tab === 'payments' && <>
          <div className="flex flex-col items-center justify-center h-full mt-10">
            <p className="text-2xl py-6">Amount to be paid</p>
            <p className="text-2xl italic py-6">USDC ${amount}</p>
            {amount > 0 && walletAuth && <Button
              className={`text-3xl rounded-full px-6 py-8 w-4/5 border-2 border-white`}
              onClick={() => sendPayment(walletAuth.address, amount)}
              disabled={amount === 0}
            >
              Get My Money
            </Button>}
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
                  className={`text-3xl rounded-full px-6 py-8 w-4/5 ${walletAuth ? 'opacity-50 cursor-not-allowed border-2 border-green-500' : 'border-2 border-white'}`}
                  onClick={signInWithWallet}
                  disabled={!!walletAuth}
                >
                  <span className={walletAuth ? 'text-green-500' : ''}>
                    {walletAuth ? '✅ ' : ''}Sign with wallet
                  </span>
                </Button>
                {!walletAuth && (
                  <p className="text-md italic text-center mt-2">To get started, sign in with your wallet</p>
                )}
              </div>

              {walletAuth && (
                <div className="flex flex-col items-center w-full">
                  <Button
                    className={`text-3xl rounded-full px-6 py-8 w-4/5 ${location && !location.success ? 'border-2 border-yellow-500' : (location ? 'opacity-50 cursor-not-allowed border-2 border-green-500' : 'border-2 border-white')}`}
                    onClick={getLocation}
                    disabled={!!location}
                  >
                    <span className={walletAuth ? (location && !location.success ? 'text-yellow-500' : 'text-green-500') : ''}>
                      {location && !location.success ? '🟡 ' : (location ? '✅ ' : '')}Share location
                    </span>
                  </Button>
                  {!location && (
                    <p className="text-md italic text-center mt-2">Share your location to act as a local expert</p>
                  )}
                  {location && location.success && (
                    <p className="text-md italic text-center mt-2">Location: {location.city}, {location.country}</p>
                  )}
                  {location && !location.success && (
                    <p className="text-md italic text-center mt-2">Could not get location</p>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </main>
      <div className={`fixed bottom-0 w-full transition-all duration-700 ease-in-out ${
        walletAuth && location ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`} >
        <BottomNav tab={tab} setTab={setTab} />
      </div>
    </div>
  )
}
