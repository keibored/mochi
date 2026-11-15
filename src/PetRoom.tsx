import { useId } from 'react'
import { MochiBunny } from './MochiBunny'
import type { PetExpression } from './petPresentation'
import './PetRoom.css'

interface Props {
  expression: PetExpression
  speech: string
  eating: boolean
  eatingKey?: number
  onPet: () => void
}

/** Original decorative room. Only the bunny is interactive; supplied speech and
 * eating feedback come from real care/reward actions in the parent component.
 */
export function PetRoom({ expression, speech, eating, eatingKey = 0, onPet }: Props) {
  const skyId = useId()
  return (
    <div className="pet-room" data-expression={expression} data-eating={eating}>
      <svg className="room-architecture" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect width="1000" height="520" fill="#fff7f3" />
        <path d="M0 330H1000V520H0Z" fill="#f1e5eb" />
        <path d="M0 327H1000" stroke="#dfc8d3" strokeWidth="3" />
        <path d="M0 338H1000" stroke="#fffaf8" strokeWidth="6" />
        <g stroke="#d9c3cf" strokeWidth="1.5" opacity="0.5">
          <path d="M0 410H1000M0 487H1000M200 340L110 520M500 340V520M800 340L890 520" />
        </g>
      </svg>

      <svg className="room-window" viewBox="0 0 200 260" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={skyId} x1="0" x2="0.7" y1="0" y2="1">
            <stop stopColor="#e7e1f5" />
            <stop offset="1" stopColor="#f7e8ed" />
          </linearGradient>
        </defs>
        <path d="M25 235V103C25 56 55 25 100 25C145 25 175 56 175 103V235Z" fill={`url(#${skyId})`} stroke="#cfb5c7" strokeWidth="8" />
        <path d="M36 224V104C36 65 61 37 100 37C139 37 164 65 164 104V224Z" fill="none" stroke="#fffaf7" strokeWidth="6" />
        <path d="M99 36V226M36 139H164" stroke="#fffaf7" strokeWidth="6" />
        {expression === 'sleeping' ? (
          <path d="M134 72A19 19 0 0 0 153 99A22 22 0 1 1 134 72Z" fill="#fff7dc" />
        ) : (
          <circle cx="133" cy="91" r="18" fill="#fff4d8" />
        )}
        <path d="M44 179Q52 165 65 172Q70 156 83 166Q98 165 103 180Z" fill="#fffaf8" opacity="0.8" />
        <path d="M10 38Q32 27 49 40L37 111L49 169L15 200Z" fill="#edc7d4" stroke="#d9aebf" strokeWidth="2" />
        <path d="M190 38Q168 27 151 40L163 111L151 169L185 200Z" fill="#edc7d4" stroke="#d9aebf" strokeWidth="2" />
        <path d="M16 37H184M20 239H180" stroke="#d1b3c4" strokeWidth="7" strokeLinecap="round" />
        <path d="M22 136L40 132M160 132L178 136" stroke="#fff6f0" strokeWidth="5" strokeLinecap="round" />
      </svg>

      <svg className="room-rug" viewBox="0 0 520 170" aria-hidden="true" focusable="false">
        <ellipse cx="260" cy="89" rx="252" ry="72" fill="#e5dbef" stroke="#fdf9fc" strokeWidth="6" />
        <ellipse cx="260" cy="89" rx="228" ry="55" fill="none" stroke="#f5edf9" strokeWidth="3" />
        <path d="M35 75L13 68M32 91L10 92M40 108L18 116M485 75L507 68M488 91L510 92M480 108L502 116" stroke="#d8cce4" strokeWidth="4" strokeLinecap="round" />
      </svg>

      <svg className="room-cushion" viewBox="0 0 180 100" aria-hidden="true" focusable="false">
        <ellipse cx="92" cy="83" rx="80" ry="10" fill="#d9c0ce" opacity="0.35" />
        <path d="M17 28Q21 15 39 18L143 18Q163 19 166 36L170 64Q168 82 148 83H35Q13 82 12 64Z" fill="#e8b8cc" stroke="#c99db4" strokeWidth="2.5" />
        <path d="M27 37Q52 28 89 32Q125 27 151 38M31 70Q84 77 148 70" fill="none" stroke="#f9dde9" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M32 27L26 35M151 27L156 36M25 68L31 77M155 68L149 77" stroke="#d6a4bb" strokeWidth="2" strokeLinecap="round" />
      </svg>

      <svg className="room-bowl" viewBox="0 0 130 85" aria-hidden="true" focusable="false">
        <ellipse cx="65" cy="70" rx="49" ry="8" fill="#c99aae" opacity="0.2" />
        <path d="M17 33Q20 68 65 70Q110 68 113 33Z" fill="#e9bdce" stroke="#c78ba6" strokeWidth="2.5" />
        <ellipse cx="65" cy="33" rx="48" ry="13" fill="#fff8f2" stroke="#c78ba6" strokeWidth="2.5" />
        <ellipse cx="65" cy="34" rx="36" ry="7" fill="#f2e7e6" />
        <path d="M65 60L58 53C53 47 60 43 65 49C70 43 77 47 72 53Z" fill="#fff4f4" />
      </svg>

      <p className="pet-speech" role="status" aria-live="polite" aria-atomic="true">{speech}</p>
      <button className="pet-character-button" type="button" onClick={onPet} aria-label="Say hello to Mochi">
        <MochiBunny key={eatingKey} expression={expression} />
      </button>

      {eating && (
        <div className="room-treat-path" key={eatingKey} aria-hidden="true">
          <svg className="room-treat" viewBox="0 0 40 60" focusable="false">
            <path d="M17 17L10 50Q8 60 15 53L32 27Q35 18 26 17Z" fill="#dda16d" stroke="#bf8056" strokeWidth="1.5" />
            <path d="M22 18Q12 9 17 4Q23 2 25 15Q27 2 33 4Q39 8 27 18" fill="#8aa584" stroke="#6c8a70" strokeWidth="1.5" />
            <path d="M16 29L21 32M22 39L25 41" stroke="#f1c197" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
