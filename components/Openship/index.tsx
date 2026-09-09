'use client'

import { useState, type ReactNode } from 'react'

type View = 'human' | 'agent'

const VIEWS: { view: View; label: string; hint: string }[] = [
  { view: 'human', label: 'Human', hint: 'What OpenShip is and why it exists' },
  { view: 'agent', label: 'Agent', hint: 'Instructions for retrieving the source' },
]

type Props = {
  human: ReactNode
  agent: ReactNode
}

/**
 * Both views are rendered on the server and passed in as props, so switching between them ships no
 * content to the client — only the toggle itself is interactive.
 */
const OpenshipViews = ({ human, agent }: Props) => {
  const [view, setView] = useState<View>('human')

  return (
    <div>
      <div id="openship-panel" role="tabpanel" aria-labelledby={`openship-tab-${view}`}>
        {view === 'human' ? human : agent}
      </div>

      <div className="mt-10 border-t pt-5 sm:mt-12">
        <div className="flex items-center gap-1" role="tablist" aria-label="OpenShip audience">
          {VIEWS.map(item => (
            <button
              key={item.view}
              id={`openship-tab-${item.view}`}
              type="button"
              role="tab"
              aria-selected={view === item.view}
              aria-controls="openship-panel"
              onClick={() => setView(item.view)}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                view === item.view
                  ? 'border-blurple text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {VIEWS.find(item => item.view === view)?.hint}
        </p>
      </div>
    </div>
  )
}

export default OpenshipViews
