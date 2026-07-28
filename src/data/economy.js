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
// Beating your own star record is what a level really pays for; a replay that
// matches it pays a token amount instead. Paying full price for a repeat turns
// the easiest early level into a coin farm — grinding it beats progressing,
// which is worse to play and impossible to balance around. But paying NOTHING
// is worse still: target times are generous, so most first clears are already
// three stars, and a level would then pay exactly once ever. A replay you
// can't improve on would be literally pointless, and that reads as a bug.
// Roughly a tenth of a first clear keeps a lap worth driving without ever
// making it the efficient way to earn.
export function calcPayout(level, timeSeconds, stars, airTimeSeconds, prevBestStars) {
  const base = level.basePayout;
  const prev = prevBestStars || 0;
  const styleBonus = (cap) => Math.min(Math.round(airTimeSeconds * 15), Math.round(base * cap));

  if (stars <= prev) return Math.round(base * 0.12) + styleBonus(0.12);

  let coins = Math.round(base * (0.4 + 0.2 * stars));
  coins += styleBonus(0.3);
  // First-time star improvements pay a chunky one-off bonus.
  coins += (stars - prev) * Math.round(base * 0.5);
  return coins;
}

export const DAILY_BONUS = 200;
