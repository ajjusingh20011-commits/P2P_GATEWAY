/**
 * Regression test — smooth weighted round-robin selection (Item 1).
 *
 * Guards the fairness fix: routing SELECTION must spread orders proportionally
 * to each candidate's success-rate weight, not hand nearly everything to the
 * single top scorer. These are the trader-verified examples from the spec:
 *   - weights 87/71/58/41/33 over 5 orders -> each account wins exactly once
 *     (fairness holds even in small batches);
 *   - over 30 orders the split is proportional to the weights, not
 *     winner-takes-all;
 *   - equal weights degenerate to plain round-robin with no special-casing.
 *
 * If this regresses, one account is monopolising orders again — do not "fix" it
 * by loosening the assertions.
 */
const { pick } = require('../src/services/weightedRotation');

/** Run `orders` selections over fixed weights, returning per-node win counts. */
function distribute(weights, orders) {
  const nodes = weights.map((w, i) => ({ key: i, weight: w, current: 0 }));
  const counts = weights.map(() => 0);
  for (let o = 0; o < orders; o += 1) {
    const winner = pick(nodes);
    counts[winner.key] += 1;
  }
  return counts;
}

test('87/71/58/41/33 over 5 orders — each account wins exactly once', () => {
  expect(distribute([87, 71, 58, 41, 33], 5)).toEqual([1, 1, 1, 1, 1]);
});

test('87/71/58/41/33 over 30 orders — proportional, not winner-takes-all', () => {
  const counts = distribute([87, 71, 58, 41, 33], 30);
  // Ideal 30*w/290 = 9.0/7.3/6.0/4.2/3.4 — allow ±1 for rounding.
  const ideal = [9, 7.3, 6, 4.2, 3.4];
  counts.forEach((c, i) => expect(Math.abs(c - ideal[i])).toBeLessThanOrEqual(1));
  // Strictly monotonic-ish: the top account never gets less than the bottom.
  expect(counts[0]).toBeGreaterThan(counts[4]);
  // And nobody is starved to zero.
  expect(Math.min(...counts)).toBeGreaterThan(0);
});

test('equal weights degenerate to plain round-robin', () => {
  expect(distribute([50, 50, 50], 9)).toEqual([3, 3, 3]);
});

test('a full weight-sum cycle gives each node exactly its weight in wins', () => {
  const weights = [3, 2, 1]; // sum 6
  expect(distribute(weights, 6)).toEqual([3, 2, 1]);
});

test('empty pool returns null; single node always wins', () => {
  expect(pick([])).toBeNull();
  const solo = [{ key: 'a', weight: 50, current: 0 }];
  expect(pick(solo).key).toBe('a');
});
