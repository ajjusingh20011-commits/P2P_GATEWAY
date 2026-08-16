'use strict';

/**
 * Smooth weighted round-robin (SWRR) — the selection half of routing, kept
 * strictly separate from eligibility.
 *
 * Eligibility decides WHICH accounts/traders may receive an order (unchanged —
 * see routingEngine.eligibleAccountsFor / eligibleTraders). This module decides
 * WHICH of the already-eligible ones actually gets the next order, so volume is
 * spread proportionally to each candidate's weight (its success-rate score)
 * instead of the single top scorer taking nearly everything.
 *
 * Algorithm (the exact nginx/load-balancer SWRR):
 *   each selection:
 *     for every candidate i:  current_i += weight_i
 *     winner = argmax(current_i)
 *     current_winner -= sum(weight_i)     // over the candidates that took part
 *
 * `current` is mutable per-candidate state that persists ACROSS selections — the
 * caller owns where it is stored (routingEngine keeps it in Redis with an
 * in-memory fallback, keyed by account/trader id) and passes it back in on the
 * next call. A candidate that is ineligible for a given order simply isn't in
 * `nodes` that round; it keeps whatever credit it had accumulated for the next
 * time it qualifies.
 *
 * Properties this gives us, matching the spec's verified examples:
 *   - weights 87/71/58/41/33 over 5 orders -> each wins exactly once;
 *   - over a full cycle (sum of weights) each wins exactly weight_i times, so
 *     over many orders the split is proportional to the weights;
 *   - equal weights degenerate to plain round-robin with no special-casing.
 */

/**
 * Advance the SWRR state by one selection and return the winning node.
 *
 * @param {Array<{key:(string|number), weight:number, current:number}>} nodes
 *   The CURRENTLY eligible candidates. `weight` is the candidate's score-derived
 *   weight (must be > 0 to ever win). `current` is its persisted accumulated
 *   credit (0 if new). This function MUTATES each node's `current` in place, so
 *   the caller can persist the updated values afterwards.
 * @returns the winning node object (a reference into `nodes`), or null when
 *   there are no nodes or every weight is <= 0.
 */
function pick(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  let totalWeight = 0;
  let winner = null;

  for (const node of nodes) {
    const weight = Number(node.weight) > 0 ? Number(node.weight) : 0;
    node.current = (Number(node.current) || 0) + weight;
    totalWeight += weight;
    if (winner === null || node.current > winner.current) {
      winner = node;
    }
  }

  if (winner === null || totalWeight <= 0) return null;

  winner.current -= totalWeight;
  return winner;
}

module.exports = { pick };
