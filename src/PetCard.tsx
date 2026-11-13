import { useEffect, useState } from 'react'
import { FEED_COST, FIRST_MILESTONE_XP } from './rewards'
import type { PetState } from './petState'
import { petExpression } from './petPresentation'
import { MochiBunny } from './MochiBunny'
import { AppIcon } from './AppIcon'

export interface PetReaction { mood: string; expression: 'happy' | 'sleepy' | null }

export function PetCard({ pet, reaction, busy, onFeed }: { pet: PetState; reaction: PetReaction | null; busy: boolean; onFeed: () => void }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!pet.timer || pet.timer.runningSince === null) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [pet.timer])
  const expression = petExpression(reaction?.expression ?? null, pet.timer, now)
  const mood = reaction?.mood ?? (expression === 'focusing' ? 'Keeping you company while you focus.' : 'Feeling cozy, right here with you.')
  const canFeed = pet.foodCredits >= FEED_COST
  return (
    <section className="panel pet-card" aria-labelledby="pet-heading">
      <div className="pet-card-header"><h2 id="pet-heading">{pet.name}</h2><p className="pet-mood">{mood}</p></div>
      <div className="pet-stage"><MochiBunny expression={expression} /></div>
      <div className="pet-bottom">
        <dl className="pet-stats"><div><dt>Lifetime XP</dt><dd>{pet.xp} <small>XP</small></dd></div><div><dt>Food credits</dt><dd>{pet.foodCredits} <AppIcon name="carrot" /></dd></div></dl>
        <div className="xp-row"><label htmlFor="xp-progress">First milestone</label><span>{pet.xp} / {FIRST_MILESTONE_XP} XP</span></div>
        <progress id="xp-progress" max={FIRST_MILESTONE_XP} value={Math.min(pet.xp, FIRST_MILESTONE_XP)} />
        {pet.xp >= FIRST_MILESTONE_XP && <p className="help-text">First milestone reached ♡</p>}
        <div className="feed-row"><button className="adopt-button" type="button" disabled={busy || !canFeed} onClick={onFeed} aria-describedby="feeding-help"><AppIcon name="carrot" />Feed {pet.name}</button><span>{FEED_COST} food credits</span></div>
        <p id="feeding-help" className="help-text feeding-help">{canFeed ? 'A little treat for your companion.' : pet.extensionSync.authorityStartedAt !== null ? 'Earn 2 credits with 15 reward-eligible browser Focus minutes.' : 'Save 15 Focus minutes to earn 2 food credits.'}</p>
      </div>
    </section>
  )
}
