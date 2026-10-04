/** Returns a display copy ordered by the canonical Round sequence, newest first. */
export function newestRoundsFirst<T extends { roundNumber: number }>(rounds: readonly T[]): T[] {
  return [...rounds].sort((a, b) => b.roundNumber - a.roundNumber);
}
