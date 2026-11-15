import { useId } from 'react'
import type { PetExpression } from './petPresentation'

export type BunnyExpression = PetExpression

const descriptions: Record<BunnyExpression, string> = {
  cozy: 'feeling cozy',
  happy: 'feeling happy',
  sleeping: 'sleeping during intentional rest',
  'under-the-weather': 'looking under the weather and ready for gentle care',
  hungry: 'feeling hungry, with drooping ears',
  tired: 'feeling tired',
  focusing: 'quietly focusing with you',
}

/** Original fictional companion; visible care cues follow the shared priority. */
export function MochiBunny({ expression = 'cozy' }: { expression?: BunnyExpression }) {
  const titleId = useId()
  return (
    <svg className="mochi-bunny" data-expression={expression} viewBox="0 0 300 300" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Mochi the bunny, {descriptions[expression]}</title>
      <ellipse cx="150" cy="273" rx="77" ry="9" fill="#c78da5" opacity="0.15" />
      <g className="bunny-figure">
        <circle cx="231" cy="221" r="19" fill="#fff9ed" stroke="#d9b8b5" strokeWidth="2" />
        <g className="bunny-ear-left">
          <path d="M105 130C91 104 76 49 91 28C101 13 115 26 124 49L142 112Z" fill="#fff9ed" stroke="#cda6a8" strokeWidth="2.4" />
          <path d="M108 110C99 88 88 49 96 37C102 29 109 44 114 60L128 111Z" fill="#f3bdc8" />
        </g>
        <g className="bunny-ear-right">
          <path d="M158 112L177 48C185 24 201 13 211 28C225 49 208 106 195 130Z" fill="#fff9ed" stroke="#cda6a8" strokeWidth="2.4" />
          <path d="M172 111L186 59C191 43 199 30 205 38C212 50 201 91 192 112Z" fill="#f3bdc8" />
        </g>
        <path d="M77 175C77 127 102 99 150 99C198 99 224 127 224 175C224 193 233 211 230 229C226 256 196 267 150 267C104 267 74 256 70 229C67 211 77 193 77 175Z" fill="#fff9ed" stroke="#cda6a8" strokeWidth="2.4" />
        <ellipse cx="108" cy="252" rx="27" ry="13" fill="#fff4e7" stroke="#d7b1af" strokeWidth="2" />
        <ellipse cx="192" cy="252" rx="27" ry="13" fill="#fff4e7" stroke="#d7b1af" strokeWidth="2" />
        <path d="M88 205C90 218 98 222 108 222M212 205C210 218 202 222 192 222" fill="none" stroke="#d7b1af" strokeWidth="2.4" strokeLinecap="round" />
        <ellipse className="bunny-cheek" cx="108" cy="187" rx="15" ry="9" />
        <ellipse className="bunny-cheek" cx="192" cy="187" rx="15" ry="9" />
        {expression === 'sleeping' ? (
          <g className="bunny-line">
            <path d="M115 171Q123 178 131 171M169 171Q177 178 185 171" />
            <ellipse cx="150" cy="194" rx="3.5" ry="4" strokeWidth="2.2" />
          </g>
        ) : expression === 'under-the-weather' || expression === 'tired' ? (
          <g className="bunny-line">
            <path d="M115 173Q123 169 131 173M169 173Q177 169 185 173" />
            <path d="M145 195Q150 192 155 195" strokeWidth="2.6" />
            <path d="M115 177L122 178M178 178L185 177" strokeWidth="1.8" opacity="0.55" />
          </g>
        ) : expression === 'hungry' ? (
          <g>
            <ellipse className="bunny-face" cx="123" cy="175" rx="3.6" ry="4.5" />
            <ellipse className="bunny-face" cx="177" cy="175" rx="3.6" ry="4.5" />
            <path className="bunny-line" d="M116 165L128 162M172 162L184 165" strokeWidth="2" />
            <ellipse className="bunny-line" cx="150" cy="195" rx="4" ry="3.5" strokeWidth="2.4" />
          </g>
        ) : expression === 'happy' ? (
          <g>
            <ellipse className="bunny-face" cx="123" cy="172" rx="4.6" ry="6" />
            <ellipse className="bunny-face" cx="177" cy="172" rx="4.6" ry="6" />
            <circle cx="121.5" cy="169.5" r="1.5" fill="#fffdf8" />
            <circle cx="175.5" cy="169.5" r="1.5" fill="#fffdf8" />
            <path className="bunny-line" d="M142 192Q150 203 158 192" />
          </g>
        ) : (
          <g>
            <ellipse className="bunny-face" cx="123" cy="173" rx="3.6" ry={expression === 'focusing' ? '5' : '4.6'} />
            <ellipse className="bunny-face" cx="177" cy="173" rx="3.6" ry={expression === 'focusing' ? '5' : '4.6'} />
            {expression === 'focusing' && <path className="bunny-line" d="M116 161L127 163M173 163L184 161" strokeWidth="2.2" />}
            <path className="bunny-line" d="M142 192Q146 197 150 192Q154 197 158 192" strokeWidth="2.6" />
          </g>
        )}
        <path d="M146 183Q150 180 154 183L150 187Z" fill="#b47989" />
        <ellipse cx="150" cy="230" rx="18" ry="11" fill="#f6e8df" opacity="0.55" />
        {expression === 'under-the-weather' && (
          <g className="bunny-recovery-cue">
            <rect x="176" y="211" width="31" height="23" rx="7" fill="#f6dbe4" stroke="#d5a1b5" strokeWidth="1.5" transform="rotate(-12 191 223)" />
            <path d="M191 228L185 222C181 217 187 214 191 219C195 214 201 217 197 222Z" fill="#c7829c" />
          </g>
        )}
      </g>
      {expression === 'sleeping' && (
        <g className="bunny-zzz" fill="#987ca5" fontWeight="600" aria-hidden="true">
          <text x="222" y="115" fontSize="16">z</text>
          <text x="240" y="91" fontSize="21">z</text>
          <text x="260" y="63" fontSize="26">z</text>
        </g>
      )}
      {expression === 'hungry' && (
        <g className="bunny-bowl-thought" aria-hidden="true">
          <circle cx="224" cy="141" r="3" fill="#fffdf8" stroke="#dac2d3" />
          <circle cx="234" cy="131" r="5" fill="#fffdf8" stroke="#dac2d3" />
          <circle cx="253" cy="109" r="23" fill="#fffdf8" stroke="#dac2d3" strokeWidth="1.5" />
          <ellipse cx="253" cy="105" rx="13" ry="4" fill="#fff7f5" stroke="#bd849e" strokeWidth="1.5" />
          <path d="M240 106Q242 119 253 119Q264 119 266 106" fill="none" stroke="#bd849e" strokeWidth="1.8" />
        </g>
      )}
    </svg>
  )
}
