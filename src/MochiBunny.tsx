import { useId } from 'react'

export type BunnyExpression = 'cozy' | 'happy' | 'sleepy' | 'focusing'

const descriptions: Record<BunnyExpression, string> = {
  cozy: 'feeling cozy',
  happy: 'feeling happy',
  sleepy: 'settling in for a little rest',
  focusing: 'quietly focusing with you',
}

/** Original reusable mascot; expressions do not imply pet health or hunger. */
export function MochiBunny({ expression = 'cozy' }: { expression?: BunnyExpression }) {
  const titleId = useId()
  return (
    <svg className="mochi-bunny" data-expression={expression} viewBox="0 0 300 300" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Mochi the bunny, {descriptions[expression]}</title>
      <ellipse cx="150" cy="273" rx="77" ry="9" fill="#c78da5" opacity="0.15" />
      <g className="bunny-figure">
        <circle cx="231" cy="221" r="19" fill="#fff9ed" stroke="#d9b8b5" strokeWidth="2" />
        <path d="M105 130C91 104 76 49 91 28C101 13 115 26 124 49L142 112Z" fill="#fff9ed" stroke="#cda6a8" strokeWidth="2.4" />
        <path d="M108 110C99 88 88 49 96 37C102 29 109 44 114 60L128 111Z" fill="#f3bdc8" />
        <path d="M158 112L177 48C185 24 201 13 211 28C225 49 208 106 195 130Z" fill="#fff9ed" stroke="#cda6a8" strokeWidth="2.4" />
        <path d="M172 111L186 59C191 43 199 30 205 38C212 50 201 91 192 112Z" fill="#f3bdc8" />
        <path d="M77 175C77 127 102 99 150 99C198 99 224 127 224 175C224 193 233 211 230 229C226 256 196 267 150 267C104 267 74 256 70 229C67 211 77 193 77 175Z" fill="#fff9ed" stroke="#cda6a8" strokeWidth="2.4" />
        <ellipse cx="108" cy="252" rx="27" ry="13" fill="#fff4e7" stroke="#d7b1af" strokeWidth="2" />
        <ellipse cx="192" cy="252" rx="27" ry="13" fill="#fff4e7" stroke="#d7b1af" strokeWidth="2" />
        <path d="M88 205C90 218 98 222 108 222M212 205C210 218 202 222 192 222" fill="none" stroke="#d7b1af" strokeWidth="2.4" strokeLinecap="round" />
        <ellipse className="bunny-cheek" cx="108" cy="187" rx="15" ry="9" />
        <ellipse className="bunny-cheek" cx="192" cy="187" rx="15" ry="9" />
        {expression === 'sleepy' ? (
          <g className="bunny-line">
            <path d="M115 171Q123 178 131 171M169 171Q177 178 185 171" />
            <path d="M145 194Q150 191 155 194" />
          </g>
        ) : expression === 'happy' ? (
          <g className="bunny-line">
            <path d="M115 174Q123 163 131 174M169 174Q177 163 185 174" />
            <path d="M142 192Q150 203 158 192" />
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
      </g>
    </svg>
  )
}
