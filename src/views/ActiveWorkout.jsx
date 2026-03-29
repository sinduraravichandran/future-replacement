import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import './ActiveWorkout.css'

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.3)
  } catch (_) {}
}

export default function ActiveWorkout({ workoutId, onDone }) {
  const [workout, setWorkout] = useState(null)
  const [exercises, setExercises] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [currentSet, setCurrentSet] = useState(1)
  const [setLogs, setSetLogs] = useState({}) // { exerciseId_setNum: { reps, weight } }
  const [resting, setResting] = useState(false)
  const [restSecondsLeft, setRestSecondsLeft] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [workoutLogId, setWorkoutLogId] = useState(null)
  const [startTime] = useState(Date.now())
  const [done, setDone] = useState(false)
  const [totalDuration, setTotalDuration] = useState(0)
  const restTimerRef = useRef(null)

  useEffect(() => {
    loadWorkout()
  }, [workoutId])

  async function loadWorkout() {
    const { data: w } = await supabase.from('workouts').select('*').eq('id', workoutId).single()
    const { data: ex } = await supabase
      .from('exercises').select('*').eq('workout_id', workoutId).order('order', { ascending: true })
    setWorkout(w)
    setExercises(ex || [])

    // Create workout log
    const { data: log } = await supabase
      .from('workout_logs')
      .insert({ workout_id: workoutId })
      .select()
      .single()
    setWorkoutLogId(log.id)

    // Mark workout as in-progress (reuse upcoming status until done)
  }

  const currentEx = exercises[currentIdx]

  function getLogKey(exId, setNum) { return `${exId}_${setNum}` }

  function getSetValue(field) {
    if (!currentEx) return ''
    const key = getLogKey(currentEx.id, currentSet)
    if (setLogs[key]?.[field] !== undefined) return setLogs[key][field]
    return field === 'reps'
      ? (currentEx.reps ?? '')
      : (currentEx.weight_lbs ?? '')
  }

  function updateSetValue(field, value) {
    const totalSets = currentEx.sets || 1
    setSetLogs(prev => {
      const updates = { [getLogKey(currentEx.id, currentSet)]: { ...prev[getLogKey(currentEx.id, currentSet)], [field]: value } }
      // Propagate weight changes to all future sets of this exercise
      if (field === 'weight') {
        for (let s = currentSet + 1; s <= totalSets; s++) {
          const k = getLogKey(currentEx.id, s)
          updates[k] = { ...prev[k], weight: value }
        }
      }
      return { ...prev, ...updates }
    })
  }

  async function completeSet() {
    const key = getLogKey(currentEx.id, currentSet)
    const vals = setLogs[key] || {}
    const actualReps = vals.reps !== undefined ? Number(vals.reps) : null
    const actualWeight = vals.weight !== undefined ? Number(vals.weight) : null

    // Log to DB
    if (workoutLogId) {
      await supabase.from('exercise_logs').insert({
        workout_log_id: workoutLogId,
        exercise_id: currentEx.id,
        set_number: currentSet,
        actual_reps: actualReps,
        actual_weight_lbs: actualWeight,
      })
    }

    const totalSets = currentEx.sets || 1
    if (currentSet < totalSets) {
      // Start rest timer
      const restSecs = currentEx.rest_seconds || 60
      startRestTimer(restSecs, () => {
        setCurrentSet(s => s + 1)
      })
    } else {
      // Move to next exercise
      advanceExercise()
    }
  }

  function startRestTimer(seconds, onComplete) {
    setResting(true)
    setRestSecondsLeft(seconds)
    let remaining = seconds
    restTimerRef.current = setInterval(() => {
      remaining -= 1
      setRestSecondsLeft(remaining)
      if (remaining <= 0) {
        clearInterval(restTimerRef.current)
        setResting(false)
        beep()
        onComplete()
      }
    }, 1000)
  }

  function skipRest() {
    clearInterval(restTimerRef.current)
    setResting(false)
    setCurrentSet(s => s + 1)
  }

  function advanceExercise() {
    clearInterval(restTimerRef.current)
    setResting(false)
    if (currentIdx + 1 >= exercises.length) {
      finishWorkout()
    } else {
      setCurrentIdx(i => i + 1)
      setCurrentSet(1)
    }
  }

  async function finishWorkout() {
    const duration = Math.floor((Date.now() - startTime) / 1000)
    setTotalDuration(duration)

    if (workoutLogId) {
      await supabase.from('workout_logs').update({ duration_seconds: duration, completed_at: new Date().toISOString() }).eq('id', workoutLogId)
    }
    await supabase.from('workouts').update({ status: 'completed' }).eq('id', workoutId)
    setDone(true)
  }

  useEffect(() => {
    return () => clearInterval(restTimerRef.current)
  }, [])

  if (!workout || exercises.length === 0) {
    return (
      <div className="aw-loading">
        <div className="spinner" />
        <p>Loading workout...</p>
      </div>
    )
  }

  if (done) {
    const mins = Math.floor(totalDuration / 60)
    const secs = totalDuration % 60
    return (
      <div className="aw-done">
        <div className="done-icon">✓</div>
        <h2>Workout Complete</h2>
        <p className="done-time">{mins}:{String(secs).padStart(2,'0')}</p>
        <p className="done-sub">{exercises.length} exercises · {workout.name}</p>
        <button className="btn-primary" onClick={onDone}>Back to Schedule</button>
      </div>
    )
  }

  const isCardio = currentEx?.category === 'cardio'
  const totalSets = currentEx?.sets || 1
  const completedExercises = exercises.slice(0, currentIdx)

  return (
    <div className="aw-root">
      {/* Header */}
      <div className="aw-header">
        <button className="aw-exit" onClick={() => { if (confirm('End workout?')) { finishWorkout() } }}>✕</button>
        <div className="aw-header-center">
          <span className="aw-workout-name">{workout.name}</span>
          <ElapsedTimer startTime={startTime} />
        </div>
        <div style={{width: 36}} />
      </div>

      {/* Exercise card */}
      <div className="aw-content">
        <div className="aw-progress">
          <span className="aw-progress-text">{currentIdx + 1} / {exercises.length}</span>
          <div className="aw-progress-bar">
            <div className="aw-progress-fill" style={{ width: `${((currentIdx) / exercises.length) * 100}%` }} />
          </div>
        </div>

        <div className="ex-card">
          <span className={`ex-cat-label cat-${currentEx.category}`}>{currentEx.category}</span>
          <h2 className="ex-card-name">{currentEx.name}</h2>

          {!isCardio && (
            <div className="set-indicator">
              {Array.from({ length: totalSets }).map((_, i) => (
                <div key={i} className={`set-dot ${i < currentSet - 1 ? 'done' : i === currentSet - 1 ? 'active' : ''}`} />
              ))}
            </div>
          )}

          {resting ? (
            <RestTimer secondsLeft={restSecondsLeft} onSkip={skipRest} />
          ) : isCardio ? (
            <CardioView exercise={currentEx} onDone={advanceExercise} />
          ) : (
            <StrengthSetView
              exercise={currentEx}
              setNum={currentSet}
              totalSets={totalSets}
              repsValue={getSetValue('reps')}
              weightValue={getSetValue('weight')}
              onRepsChange={v => updateSetValue('reps', v)}
              onWeightChange={v => updateSetValue('weight', v)}
              onCompleteSet={completeSet}
            />
          )}

          {currentEx.notes && (
            <p className="ex-notes">{currentEx.notes}</p>
          )}
        </div>
      </div>

      {/* Drawer toggle */}
      <button className="drawer-toggle" onClick={() => setDrawerOpen(true)}>
        <ListIcon />
        <span>View Workout</span>
      </button>

      {/* Workout Overview Drawer */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="drawer-header">
              <h3>Workout</h3>
              <button className="sheet-close" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <div className="drawer-list">
              {exercises.map((ex, i) => (
                <div
                  key={ex.id}
                  className={`drawer-item ${i < currentIdx ? 'done' : i === currentIdx ? 'current' : ''}`}
                >
                  <div className="drawer-check">
                    {i < currentIdx ? '✓' : i === currentIdx ? '▶' : String(i + 1)}
                  </div>
                  <div className="drawer-ex-info">
                    <span className="drawer-ex-name">{ex.name}</span>
                    {ex.sets && ex.reps && (
                      <span className="drawer-ex-detail">{ex.sets} × {ex.reps}{ex.weight_lbs ? ` · ${ex.weight_lbs}lb` : ''}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ElapsedTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startTime])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return <span className="elapsed">{m}:{String(s).padStart(2,'0')}</span>
}

function StrengthSetView({ exercise, setNum, totalSets, repsValue, weightValue, onRepsChange, onWeightChange, onCompleteSet }) {
  return (
    <div className="strength-view">
      <div className="set-label">Set {setNum} of {totalSets}</div>
      <div className="input-row">
        <div className="input-group">
          <label>Reps</label>
          <input
            type="text"
            inputMode="numeric"
            value={repsValue}
            onChange={e => onRepsChange(e.target.value)}
            className="set-input"
          />
        </div>
        <div className="input-sep">×</div>
        <div className="input-group">
          <label>Weight (lb)</label>
          <input
            type="number"
            inputMode="decimal"
            value={weightValue}
            onChange={e => onWeightChange(e.target.value)}
            className="set-input"
          />
        </div>
      </div>
      <button className="btn-primary btn-full btn-lg" onClick={onCompleteSet}>
        Complete Set
      </button>
    </div>
  )
}

function RestTimer({ secondsLeft, onSkip }) {
  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  return (
    <div className="rest-view">
      <p className="rest-label">Rest</p>
      <p className="rest-countdown">{mins > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : `${secs}s`}</p>
      <button className="btn-secondary" onClick={onSkip}>Skip</button>
    </div>
  )
}

function CardioView({ exercise, onDone }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return (
    <div className="cardio-view">
      <p className="cardio-timer">{m}:{String(s).padStart(2,'0')}</p>
      <p className="cardio-note">{exercise.notes}</p>
      <button className="btn-primary btn-full btn-lg" onClick={onDone}>Done</button>
    </div>
  )
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/>
      <line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  )
}
