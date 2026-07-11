// Payout & star rules (spec §5.1, §6.1).

// Stars: 1 = finish, +1 = no flip, +1 = under target time.
export function calcStars(level, timeSeconds, flipped) {
  let stars = 1;
  if (!flipped) stars++;
  if (timeSeconds <= level.targetTime) stars++;
  return stars;
}

// Coins earned for a run. Style bonus: total airtime, capped.
export function calcPayout(level, timeSeconds, stars, airTimeSeconds, prevBestStars) {
  const base = level.basePayout;
  let coins = Math.round(base * (0.4 + 0.2 * stars));
  coins += Math.min(Math.round(airTimeSeconds * 15), Math.round(base * 0.3));
  // First-time star improvements pay a chunky one-off bonus.
  const newStars = Math.max(0, stars - (prevBestStars || 0));
  coins += newStars * Math.round(base * 0.5);
  return coins;
}

export const DAILY_BONUS = 200;
