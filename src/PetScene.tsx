import { useEffect, useState } from 'react'
import type { PetState } from './petState'
import { FEED_COST, DAILY_REWARD_CAP, MINUTES_PER_REWARD } from './rewards'
import { dashboardSummary, formatMinutes } from './integration/activityView'
import { petExpression } from './petPresentation'
import { petLevel } from './petLevels'
import { PetRoom } from './PetRoom'
import { AppIcon } from './AppIcon'
import './PetScene.css'

interface Props {
  pet: PetState
  today: Date
  busy: boolean
  canPersist: boolean
  feedingId: number | null
  reward: { id: number; xp: number; credits: number } | null
  confirmRest: boolean
  onFeed: () => void
  onRest: () => void
  onWake: () => void
  onFocus: () => void
  onConfirmRest: () => void
  onCancelRest: () => void
}

export function PetScene({ pet, today, busy, canPersist, feedingId, reward, confirmRest, onFeed, onRest, onWake, onFocus, onConfirmRest, onCancelRest }: Props) {
  const [now, setNow] = useState(Date.now)
  const [greeting, setGreeting] = useState(false)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    if (!greeting) return
    const timeout = window.setTimeout(() => setGreeting(false), 3500)
    return () => window.clearTimeout(timeout)
  }, [greeting])
  const expression = petExpression(pet.care, pet.timer, now, feedingId !== null || reward !== null)
  const level = petLevel(pet.xp)
  const focus = Math.min(dashboardSummary(pet.activities, pet.extensionSync, today).Focus, DAILY_REWARD_CAP)
  const speech = {
    sleeping: 'A cozy rest. Wake me whenever you’re ready.',
    'under-the-weather': 'A snack and a little care will help me feel cozy again.',
    hungry: 'A little focus could earn us a snack.',
    tired: 'A little rest sounds lovely. Focus is still here whenever you need.',
    focusing: 'One little step at a time. I’m right here.',
    happy: feedingId !== null ? 'A lovely little treat. Thank you! ♡' : 'A little focus, a snack for later. ♡',
    cozy: greeting ? 'I’m happy you’re here. ♡' : 'What shall we do today?',
  }[expression]
  const full = pet.care.fullness >= 100
  const canFeed = !busy && canPersist && !full && pet.foodCredits >= FEED_COST
  return (
    <section className="pet-game" aria-labelledby="pet-scene-heading">
      <div className="scene-hud">
        <div className="scene-profile"><h2 id="pet-scene-heading">{pet.name}</h2><span>Level {level.level}</span></div>
        <div className="scene-xp"><label htmlFor="scene-xp">Lifetime XP <strong>{pet.xp}</strong></label><progress id="scene-xp" max={level.requiredXp} value={level.progressXp} /><small>{level.progressXp} / {level.requiredXp} XP to level {level.level + 1}</small></div>
        <div className="scene-meter"><label htmlFor="care-fullness">Fullness <strong>{pet.care.fullness} / 100</strong></label><meter id="care-fullness" min="0" max="100" value={pet.care.fullness} /></div>
        <div className="scene-meter"><label htmlFor="care-energy">Energy <strong>{pet.care.energy} / 100</strong></label><meter id="care-energy" min="0" max="100" value={pet.care.energy} /></div>
      </div>
      <PetRoom expression={expression} speech={speech} eating={feedingId !== null} eatingKey={feedingId ?? 0} onPet={() => setGreeting(true)} />
      <div className="scene-reward" role="status" aria-live="polite" aria-atomic="true">{reward && <span key={reward.id}>+{reward.xp} XP · +{reward.credits} food credits ♡</span>}</div>
      <div className="scene-actions" role="group" aria-label="Care for Mochi">
        <div><button className="adopt-button" type="button" disabled={!canFeed} onClick={onFeed} aria-describedby="scene-feed-help"><AppIcon name="carrot" />Feed {pet.name}</button><span className="scene-food">{pet.foodCredits} food credits</span></div>
        <button id="scene-rest-action" className="adopt-button secondary-button" type="button" disabled={busy || !canPersist} onClick={pet.care.rest ? onWake : onRest} aria-expanded={confirmRest} aria-controls={confirmRest ? 'scene-rest-confirmation' : undefined}><AppIcon name="rest" />{pet.care.rest ? 'Wake Mochi' : 'Rest'}</button>
        <button className="adopt-button secondary-button" type="button" onClick={onFocus}><AppIcon name="focus" />Focus</button>
      </div>
      <p id="scene-feed-help" className="scene-action-help">{!canPersist ? 'Care actions need available local storage. Your saved progress is preserved.' : full ? 'Full for now. Your credits stay safe.' : pet.foodCredits < FEED_COST ? '15 reward-eligible Focus minutes earns 2 food credits for a snack.' : 'A snack costs 2 credits and restores 20 fullness.'}</p>
      {confirmRest && <div id="scene-rest-confirmation" className="scene-rest-confirm" role="group" aria-labelledby="rest-question"><p id="rest-question" role="alert">Pause your current Focus timer so Mochi can rest? Your session stays saved.</p><div className="form-actions"><button id="rest-confirm-action" className="adopt-button" type="button" disabled={busy || !canPersist} onClick={onConfirmRest}>Pause timer &amp; rest</button><button className="adopt-button secondary-button" type="button" onClick={onCancelRest}>Keep focusing</button></div></div>}
      <div className="scene-quest"><div><label htmlFor="daily-quest">Daily focus quest</label><span>{formatMinutes(focus)} / {MINUTES_PER_REWARD} eligible Focus minutes</span></div><progress id="daily-quest" value={Math.min(focus, MINUTES_PER_REWARD)} max={MINUTES_PER_REWARD} /><p>Uses your existing Focus rewards. No extra quest bonus.</p></div>
    </section>
  )
}
