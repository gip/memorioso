import { Flame } from "lucide-react"

export function Header() {
  return (
    <header className="bg-purple-600 text-white p-4">
      <div className="container mx-auto flex items-center">
        <Flame className="w-8 h-8 mr-2" />
        <h1 className="text-2xl font-bold">Farcaster</h1>
      </div>
    </header>
  )
}