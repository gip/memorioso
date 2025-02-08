import { Home, DollarSign, MessageSquare } from "lucide-react"

export function BottomNav({ tab, setTab }: { tab: string, setTab: (tab: string) => void }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-12">
      <nav className="bg-[#1c1c1f] rounded-full px-6 py-3 flex items-center gap-8 shadow-lg">
        <button 
          onClick={() => setTab('home')} 
          className={`${tab === 'home' ? 'text-[#8b5cf6]' : 'text-gray-500'}`}
        >
          <Home className="w-12 h-12" />
        </button>
        <button 
          onClick={() => setTab('messages')} 
          className={`${tab === 'messages' ? 'text-[#8b5cf6]' : 'text-gray-500'}`}
        >
          <MessageSquare className="w-10 h-10" />
        </button>
        <button 
          onClick={() => setTab('notifications')} 
          className={`${tab === 'notifications' ? 'text-[#8b5cf6]' : 'text-gray-500'}`}
        >
          <DollarSign className="w-10 h-10" />
        </button>
      </nav>
    </div>
  )
}