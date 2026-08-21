'use strict';

/**
 * BUG 2 — manual fallback when automatic payout evidence capture fails.
 *
 * evidence_unverified: set true when a trader marks a BANK payout transferred
 * via the "capture didn't work — send for review" path, bypassing the automatic
 * amount/last-4 match gate. Such a payout MUST be verified by an admin before
 * settlement; the admin settlement queue flags it.
 * evidence_note: the trader's attestation note for that fallback.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { BOOLEAN, TEXT } = Sequelize;
    const table = await queryInterface.describeTable('payout_requests');
    if (!table.evidence_unverified) {
      await queryInterface.addColumn('payout_requests', 'evidence_unverified', {
        type: BOOLEAN, allowNull: false, defaultValue: false,
      });
    }
    if (!table.evidence_note) {
      await queryInterface.addColumn('payout_requests', 'evidence_note', {
        type: TEXT, allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('payout_requests');
    if (table.evidence_note) await queryInterface.removeColumn('payout_requests', 'evidence_note');
    if (table.evidence_unverified) await queryInterface.removeColumn('payout_requests', 'evidence_unverified');
  },
};
