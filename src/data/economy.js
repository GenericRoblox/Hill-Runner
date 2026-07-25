// Payout & star rules (spec §5.1, §6.1).

// Stars: 1 = finish, +1 = no flip, +1 = under target time.
export function calcStars(level, timeSeconds, flipped) {
  let stars = 1;
  if (!flipped) stars++;
  if (timeSeconds <= level.targetTime) stars++;
  return stars;
}

// Coins earned for a run. Style bonus: total airtime, capped.
//
// A replay pays ONLY if it improves the star rating. Paying for a repeat of a
// result you already have turns the easiest early level into a coin farm —
// grinding it beats playing the game, which is both worse to play and
// impossible to balance around. Every level still has three tiers of
// improvement to sell (finish / no flip / under target), so there is plenty of
// headroom before a player has taken everything a level can pay.
export function calcPayout(level, timeSeconds, stars, airTimeSeconds, prevBestStars) {
  if (stars <= (prevBestStars || 0)) return 0;
  const base = level.basePayout;
  let coins = Math.round(base * (0.4 + 0.2 * stars));
  coins += Math.min(Math.round(airTimeSeconds * 15), Math.round(base * 0.3));
  // First-time star improvements pay a chunky one-off bonus.
  const newStars = Math.max(0, stars - (prevBestStars || 0));
  coins += newStars * Math.round(base * 0.5);
  return coins;
}

export const DAILY_BONUS = 200;
