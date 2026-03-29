import { useState, useEffect, useRef } from 'react'
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
  // { exId: Set of completed set numbers }
  const [completedSets, setCompletedSets] = useState({})
  const [setLogs, setSetLogs] = useState({})
  const [resting, setResting] = useState(false)
  const [restSecondsLeft, setRestSecondsLeft] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [expandedDrawerEx, setExpandedDrawerEx] = useState(null)
  const [workoutLogId, setWorkoutLogId] = useState(null)
  const [startTime] = useState(Date.now())
  const [done, setDone] = useState(false)
  const [totalDuration, setTotalDuration] = useState(0)
  const restTimerRef = useRef(null)

  useEffect(() => { loadWorkout() }, [workoutId])

  async function loadWorkout() {
    const { data: w } = await supabase.from('workouts').select('*').eq('id', workoutId).single()
    const { data: ex } = await supabase.from('exercises').select('*').eq('workout_id', workoutId).order('order', { ascending: true })
    setWorkout(w)
    setExercises(ex || [])
    const { data: log } = await supabase.from('workout_logs').insert({ workout_id: workoutId }).select().single()
    setWorkoutLogId(log.id)
  }

  const currentEx = exercises[currentIdx]

  // Derive current set from completed sets (next uncompleted set)
  function getCurrentSet(ex) {
    if (!ex) return 1
    const done = completedSets[ex.id] || new Set()
    const total = ex.sets || 1
    for (let s = 1; s <= total; s++) {
      if (!done.has(s)) return s
    }
    return total + 1 // all done
  }

  function isExDone(ex) {
    if (!ex) return false
    const done = completedSets[ex.id] || new Set()
    return done.size >= (ex.sets || 1)
  }

  function isSetDone(exId, setNum) {
    return (completedSets[exId] || new Set()).has(setNum)
  }

  const currentSet = getCurrentSet(currentEx)
  const currentExAllSetsDone = currentEx && currentSet > (currentEx.sets || 1)
  const allExercisesDone = exercises.length > 0 && exercises.every(ex => isExDone(ex))

  function getLogKey(exId, setNum) { return `${exId}_${setNum}` }

  function getSetValue(field, ex, setNum) {
    if (!ex) return ''
    const key = getLogKey(ex.id, setNum)
    if (setLogs[key]?.[field] !== undefined) return setLogs[key][field]
    return field === 'reps' ? (ex.reps ?? '') : (ex.weight_lbs ?? '')
  }

  function updateSetValue(field, value) {
    const totalSets = currentEx.sets || 1
    setSetLogs(prev => {
      const updates = { [getLogKey(currentEx.id, currentSet)]: { ...prev[getLogKey(currentEx.id, currentSet)], [field]: value } }
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

    if (workoutLogId) {
      await supabase.from('exercise_logs').insert({
        workout_log_id: workoutLogId,
        exercise_id: currentEx.id,
        set_number: currentSet,
        actual_reps: actualReps,
        actual_weight_lbs: actualWeight,
      })
    }

    const completedSetNum = currentSet
    setCompletedSets(prev => {
      const exSets = new Set(prev[currentEx.id] || [])
      exSets.add(completedSetNum)
      return { ...prev, [currentEx.id]: exSets }
    })

    const totalSets = currentEx.sets || 1
    const willBeAllDone = completedSetNum >= totalSets
    if (!willBeAllDone) {
      startRestTimer(currentEx.rest_seconds || 60)
    }
  }

  function startRestTimer(seconds) {
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
      }
    }, 1000)
  }

  function skipRest() {
    clearInterval(restTimerRef.current)
    setResting(false)
  }

  function jumpToExercise(idx) {
    clearInterval(restTimerRef.current)
    setResting(false)
    setCurrentIdx(idx)
    setDrawerOpen(false)
  }

  function goNextExercise() {
    // Find next incomplete exercise, wrapping if needed
    const nextIncomplete = exercises.findIndex((ex, i) => i !== currentIdx && !isExDone(ex))
    if (nextIncomplete !== -1) {
      setCurrentIdx(nextIncomplete)
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

  useEffect(() => () => clearInterval(restTimerRef.current), [])

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
    const doneCount = exercises.filter(ex => isExDone(ex)).length
    return (
      <div className="aw-done">
        <div className="done-icon">✓</div>
        <h2>Workout Complete</h2>
        <p className="done-time">{mins}:{String(secs).padStart(2, '0')}</p>
        <p className="done-sub">{doneCount} of {exercises.length} exercises · {workout.name}</p>
        <button className="btn-primary" onClick={onDone}>Back to Schedule</button>
      </div>
    )
  }

  const isCardio = currentEx?.category === 'cardio'
  const totalSets = currentEx?.sets || 1
  const doneCount = exercises.filter(ex => isExDone(ex)).length

  return (
    <div className="aw-root">
      <div className="aw-header">
        <button className="aw-exit" onClick={() => { if (confirm('End workout?')) finishWorkout() }}>✕</button>
        <div className="aw-header-center">
          <span className="aw-workout-name">{workout.name}</span>
          <ElapsedTimer startTime={startTime} />
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="aw-content">
        <div className="aw-progress">
          <span className="aw-progress-text">{doneCount} / {exercises.length} exercises</span>
          <div className="aw-progress-bar">
            <div className="aw-progress-fill" style={{ width: `${(doneCount / exercises.length) * 100}%` }} />
          </div>
        </div>

        <div className="ex-card">
          <span className={`ex-cat-label cat-${currentEx.category}`}>{currentEx.category}</span>
          <h2 className="ex-card-name">{currentEx.name}</h2>

          {!isCardio && !currentExAllSetsDone && (
            <div className="set-indicator">
              {Array.from({ length: totalSets }).map((_, i) => {
                const setNum = i + 1
                const isDone = isSetDone(currentEx.id, setNum)
                const isActive = setNum === currentSet
                return <div key={i} className={`set-dot ${isDone ? 'done' : isActive ? 'active' : ''}`} />
              })}
            </div>
          )}

          {currentExAllSetsDone ? (
            <div className="ex-all-done">
              <span className="ex-done-check">✓</span>
              <p>All sets complete</p>
              {!allExercisesDone && (
                <button className="btn-primary" onClick={goNextExercise}>Next Exercise</button>
              )}
              {allExercisesDone && (
                <button className="btn-primary" onClick={finishWorkout}>Finish Workout</button>
              )}
            </div>
          ) : resting ? (
            <RestTimer secondsLeft={restSecondsLeft} onSkip={skipRest} />
          ) : isCardio ? (
            <CardioView exercise={currentEx} onDone={() => {
              setCompletedSets(prev => {
                const exSets = new Set(prev[currentEx.id] || [])
                exSets.add(1)
                return { ...prev, [currentEx.id]: exSets }
              })
            }} />
          ) : (
            <StrengthSetView
              exercise={currentEx}
              setNum={currentSet}
              totalSets={totalSets}
              repsValue={getSetValue('reps', currentEx, currentSet)}
              weightValue={getSetValue('weight', currentEx, currentSet)}
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

      <div className="aw-bottom-bar">
        <button className="drawer-toggle" onClick={() => setDrawerOpen(true)}>
          <ListIcon />
          <span>View Workout</span>
        </button>
        <button className="btn-complete-workout" onClick={() => { if (confirm('Complete workout?')) finishWorkout() }}>
          Complete
        </button>
      </div>

      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="drawer-header">
              <h3>Workout</h3>
              <button className="sheet-close" onClick={() => setDrawerOpen(false)}>✕</button>
            </div>
            <div className="drawer-list">
              {exercises.map((ex, i) => {
                const exDone = isExDone(ex)
                const isCurrent = i === currentIdx
                const isExpanded = expandedDrawerEx === ex.id
                const totalExSets = ex.sets || 1

                return (
                  <div key={ex.id} className="drawer-ex-group">
                    <button
                      className={`drawer-item ${exDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}
                      onClick={() => setExpandedDrawerEx(expandedDrawerEx === ex.id ? null : ex.id)}
                    >
                      <div className={`drawer-check ${exDone ? 'checked' : isCurrent ? 'active-check' : ''}`}>
                        {exDone ? '✓' : isCurrent ? '▶' : String(i + 1)}
                      </div>
                      <div className="drawer-ex-info">
                        <span className="drawer-ex-name">{ex.name}</span>
                        {ex.sets && ex.reps && (
                          <span className="drawer-ex-detail">{ex.sets} × {ex.reps}{ex.weight_lbs > 0 ? ` · ${ex.weight_lbs}lb` : ''}</span>
                        )}
                      </div>
                      <span className="drawer-chevron">{isExpanded ? '▲' : '▼'}</span>
                    </button>

                    {isExpanded && (
                      <div className="drawer-sets">
                        {Array.from({ length: totalExSets }).map((_, si) => {
                          const setNum = si + 1
                          const setDone = isSetDone(ex.id, setNum)
                          return (
                            <button
                              key={setNum}
                              className={`drawer-set-row ${setDone ? 'set-done' : ''}`}
                              onClick={() => jumpToExercise(i)}
                            >
                              <div className={`set-check ${setDone ? 'checked' : ''}`}>
                                {setDone ? '✓' : ''}
                              </div>
                              <span className="set-row-label">Set {setNum}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
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
  return <span className="elapsed">{m}:{String(s).padStart(2, '0')}</span>
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
      <p className="rest-countdown">{mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`}</p>
      <button className="btn-secondary" onClick={onSkip}>Skip</button>
    </div>
  )
}

function CardioView({ exercise, onDone }) {
  const [elapsed, setElapsed] = useState(0)
  const [finished, setFinished] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60

  function handleDone() {
    setFinished(true)
    onDone()
  }

  return (
    <div className="cardio-view">
      <p className="cardio-timer">{m}:{String(s).padStart(2, '0')}</p>
      <p className="cardio-note">{exercise.notes}</p>
      {!finished && <button className="btn-primary btn-full btn-lg" onClick={handleDone}>Done</button>}
    </div>
  )
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
