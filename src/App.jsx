import { useState } from 'react'
import ScheduleTab from './views/ScheduleTab.jsx'
import TrainerTab from './views/TrainerTab.jsx'
import StatsTab from './views/StatsTab.jsx'
import ActiveWorkout from './views/ActiveWorkout.jsx'
import './App.css'

export default function App() {
  const [tab, setTab] = useState('schedule')
  const [activeWorkout, setActiveWorkout] = useState(null) // { workoutId }

  if (activeWorkout) {
    return (
      <ActiveWorkout
        workoutId={activeWorkout.workoutId}
        onDone={() => setActiveWorkout(null)}
      />
    )
  }

  return (
    <div className="app">
      <div className="tab-content">
        {tab === 'schedule' && (
          <ScheduleTab onStartWorkout={(workoutId) => setActiveWorkout({ workoutId })} />
        )}
        {tab === 'trainer' && <TrainerTab />}
        {tab === 'stats' && <StatsTab />}
      </div>

      <nav className="bottom-nav">
        <button
          className={`nav-btn ${tab === 'schedule' ? 'active' : ''}`}
          onClick={() => setTab('schedule')}
        >
          <CalendarIcon />
          <span>Schedule</span>
        </button>
        <button
          className={`nav-btn ${tab === 'trainer' ? 'active' : ''}`}
          onClick={() => setTab('trainer')}
        >
          <ChatIcon />
          <span>Trainer</span>
        </button>
        <button
          className={`nav-btn ${tab === 'stats' ? 'active' : ''}`}
          onClick={() => setTab('stats')}
        >
          <StatsIcon />
          <span>Stats</span>
        </button>
      </nav>
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function StatsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )
}
