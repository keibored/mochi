type IconName = 'home' | 'activity' | 'settings' | 'arrow' | 'carrot' | 'clock' | 'focus' | 'leisure' | 'rest' | 'neutral'

const paths: Record<IconName, string> = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  activity: 'M4 19h16M5 14v-3m7 3V5m7 9V8',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  carrot: 'm14 9-3-3C8 5 3 20 4 20s15-5 14-8l-4-3Zm1-5 1 4 4-1m-3-4 1 3M8 12l2 2m1-6 2 2',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  focus: 'M12 3v3m0 12v3M3 12h3m12 0h3M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  leisure: 'm8 6 3 5 5-3-3 5 3 5-5-2-3 5v-6l-5-2 5-2Z',
  rest: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z',
  neutral: 'M6 8h12M6 16h12',
}

export function AppIcon({ name }: { name: IconName }) {
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
