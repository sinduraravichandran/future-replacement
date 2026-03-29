import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import WorkoutDetail from '../components/WorkoutDetail.jsx'
import './ScheduleTab.css'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return { dow: DAYS[date.getDay()], day: d, month: MONTHS[m - 1], year: y, date }
}

function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function isToday(dateStr) {
  return dateStr === toLocalISO(new Date())
}

function groupByMonth(days) {
  const groups = []
  for (const day of days) {
    const { month, year } = formatDate(day.dateStr)
    const label = `${month} ${year}`
    if (!groups.length || groups[groups.length - 1].monthLabel !== label) {
      groups.push({ monthLabel: label, days: [] })
    }
    groups[groups.length - 1].days.push(day)
  }
  return groups
}

export default function ScheduleTab({ onStartWorkout }) {
  const [workouts, setWorkouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedWorkout, setSelectedWorkout] = useState(null)
  const todayRef = useRef(null)

  useEffect(() => {
    fetchWorkouts()
  }, [])

  useEffect(() => {
    if (!loading && todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
  }, [loading])

  async function fetchWorkouts() {
    setLoading(true)
    const { data, error } = await supabase
      .from('workouts')
      .select('*')
      .order('scheduled_date', { ascending: true })

    if (!error) setWorkouts(data || [])
    setLoading(false)
  }

  // Group workouts by date and fill in visible date range
  function buildDayList() {
    if (workouts.length === 0) return []

    const workoutMap = {}
    workouts.forEach(w => {
      workoutMap[w.scheduled_date] = w
    })

    const first = new Date(workouts[0].scheduled_date)
    const last = new Date(workouts[workouts.length - 1].scheduled_date)

    // Show 7 days before first and 7 after last
    const start = new Date(first)
    start.setDate(start.getDate() - 7)
    const end = new Date(last)
    end.setDate(end.getDate() + 7)

    const days = []
    const cur = new Date(start)
    while (cur <= end) {
      const iso = toLocalISO(cur)
      days.push({ dateStr: iso, workout: workoutMap[iso] || null })
      cur.setDate(cur.getDate() + 1)
    }
    return days
  }

  const days = buildDayList()

  if (loading) {
    return (
      <div className="schedule-loading">
        <div className="spinner" />
        <p>Loading program...</p>
      </div>
    )
  }

  if (workouts.length === 0) {
    return (
      <div className="schedule-empty">
        <p>No program found. Generating your 16-week plan...</p>
      </div>
    )
  }

  return (
    <div className="schedule-tab">
      <div className="schedule-header">
        <h1>Schedule</h1>
      </div>
      <div className="schedule-list">
        {groupByMonth(days).map(({ monthLabel, days: monthDays }) => (
          <div key={monthLabel} className="month-group">
            <div className="month-header">{monthLabel}</div>
            {monthDays.map(({ dateStr, workout }) => {
              const { dow, day } = formatDate(dateStr)
              const today = isToday(dateStr)
              return (
                <div
                  key={dateStr}
                  className={`day-row ${today ? 'today' : ''}`}
                  ref={today ? todayRef : null}
                >
                  <div className="day-label">
                    <span className="day-dow">{dow}</span>
                    <span className={`day-num ${today ? 'today-num' : ''}`}>{day}</span>
                  </div>
                  <div className="day-content">
                    {workout ? (
                      <button
                        className={`workout-card status-${workout.status}`}
                        onClick={() => setSelectedWorkout(workout)}
                      >
                        <div className="workout-card-left">
                          <span className="workout-name">{workout.name}</span>
                          <span className="workout-meta">
                            {workout.estimated_duration_minutes}m · {workout.type}
                          </span>
                        </div>
                        <StatusBadge status={workout.status} />
                      </button>
                    ) : (
                      <div className="rest-day">Rest</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {selectedWorkout && (
        <WorkoutDetail
          workout={selectedWorkout}
          onClose={() => setSelectedWorkout(null)}
          onStart={(workoutId) => {
            setSelectedWorkout(null)
            onStartWorkout(workoutId)
          }}
          onRescheduled={fetchWorkouts}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const labels = { upcoming: 'Upcoming', completed: 'Done', missed: 'Missed' }
  return <span className={`status-badge badge-${status}`}>{labels[status]}</span>
}
