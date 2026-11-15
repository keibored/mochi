/** Lifetime XP is unchanged. Every 100 XP unlocks the next displayed level. */
export const XP_PER_LEVEL = 100

export function petLevel(xp: number) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1
  return { level, progressXp: xp % XP_PER_LEVEL, requiredXp: XP_PER_LEVEL }
}
