import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import './WorkoutDetail.css'

function toLocalISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function isToday(dateStr) {
  return dateStr === toLocalISO(new Date())
}

export default function WorkoutDetail({ workout, onClose, onStart, onRescheduled }) {
  const [exercises, setExercises] = useState([])
  const [loading, setLoading] = useState(true)
  const [swapModal, setSwapModal] = useState(null) // { todayWorkout }
  const [rescheduleMode, setRescheduleMode] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduling, setRescheduling] = useState(false)

  useEffect(() => {
    fetchExercises()
  }, [workout.id])

  async function fetchExercises() {
    setLoading(true)
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('workout_id', workout.id)
      .order('order', { ascending: true })
    setExercises(data || [])
    setLoading(false)
  }

  async function handleStart() {
    const todayStr = toLocalISO(new Date())
    const isFuture = workout.scheduled_date > todayStr

    if (isFuture) {
      // Check if there's a workout today
      const { data: todayWorkouts } = await supabase
        .from('workouts')
        .select('*')
        .eq('scheduled_date', todayStr)
        .neq('status', 'completed')
        .limit(1)

      if (todayWorkouts && todayWorkouts.length > 0) {
        setSwapModal({ todayWorkout: todayWorkouts[0] })
        return
      }
    }

    onStart(workout.id)
  }

  async function confirmSwap() {
    const { todayWorkout } = swapModal
    const todayStr = toLocalISO(new Date())

    // Swap dates
    await supabase.from('workouts').update({ scheduled_date: workout.scheduled_date }).eq('id', todayWorkout.id)
    await supabase.from('workouts').update({ scheduled_date: todayStr }).eq('id', workout.id)

    setSwapModal(null)
    onRescheduled()
    onStart(workout.id)
  }

  async function handleReschedule() {
    if (!rescheduleDate) return
    setRescheduling(true)

    // Check if target date has a workout
    const { data: existing } = await supabase
      .from('workouts')
      .select('*')
      .eq('scheduled_date', rescheduleDate)
      .neq('id', workout.id)
      .limit(1)

    if (existing && existing.length > 0) {
      // Swap
      await supabase.from('workouts').update({ scheduled_date: workout.scheduled_date }).eq('id', existing[0].id)
      await supabase.from('workouts').update({ scheduled_date: rescheduleDate }).eq('id', workout.id)
    } else {
      await supabase.from('workouts').update({ scheduled_date: rescheduleDate }).eq('id', workout.id)
    }

    setRescheduling(false)
    setRescheduleMode(false)
    onRescheduled()
    onClose()
  }

  const canStart = true
  const canMove = workout.status === 'upcoming'

  const warmup = exercises.filter(e => e.category === 'warmup')
  const main = exercises.filter(e => e.category === 'main' || e.category === 'cardio')
  const cooldown = exercises.filter(e => e.category === 'cooldown')
  const all = [...warmup, ...main, ...cooldown]

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-header">
          <div>
            <h2 className="sheet-title">{workout.name}</h2>
            <p className="sheet-meta">
              Week {workout.week_number} · {workout.estimated_duration_minutes}min · {workout.type}
            </p>
          </div>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        <div className="sheet-body">
          {loading ? (
            <div className="sheet-loading"><div className="spinner" /></div>
          ) : (
            <div className="exercise-list">
              {all.map((ex, i) => (
                <div key={ex.id} className={`exercise-row category-${ex.category}`}>
                  <div className="ex-order">{i + 1}</div>
                  <div className="ex-info">
                    <span className="ex-name">{ex.name}</span>
                    {ex.category !== 'cardio' ? (
                      <span className="ex-detail">
                        {ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.reps || ''}
                        {ex.weight_lbs > 0 ? ` · ${ex.weight_lbs}lb` : ex.weight_lbs === 0 ? ' · Bodyweight' : ''}
                        {ex.rest_seconds ? ` · ${ex.rest_seconds}s rest` : ''}
                      </span>
                    ) : (
                      <span className="ex-detail">{ex.notes}</span>
                    )}
                  </div>
                  <span className="ex-cat-badge">{ex.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sheet-footer">
          {canMove && !rescheduleMode && (
            <button className="btn-secondary" onClick={() => setRescheduleMode(true)}>
              Move to...
            </button>
          )}
          {rescheduleMode && (
            <div className="reschedule-row">
              <input
                type="date"
                value={rescheduleDate}
                min={toLocalISO(new Date())}
                onChange={e => setRescheduleDate(e.target.value)}
                className="date-input"
              />
              <button
                className="btn-primary"
                onClick={handleReschedule}
                disabled={!rescheduleDate || rescheduling}
              >
                {rescheduling ? 'Moving...' : 'Confirm'}
              </button>
              <button className="btn-ghost" onClick={() => setRescheduleMode(false)}>Cancel</button>
            </div>
          )}
          {canStart && !rescheduleMode && (
            <button className="btn-primary btn-full" onClick={handleStart}>
              Start Workout
            </button>
          )}
        </div>
      </div>

      {swapModal && (
        <div className="modal-overlay" onClick={() => setSwapModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Swap workouts?</h3>
            <p>
              You have <strong>{swapModal.todayWorkout.name}</strong> scheduled for today.
              Swap dates and start <strong>{workout.name}</strong> instead?
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setSwapModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={confirmSwap}>Swap & Start</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
