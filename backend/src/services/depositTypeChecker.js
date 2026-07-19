'use strict';

/**
 * depositTypeChecker — FTD (First Time Deposit) vs STD (Standard) detection.
 * A customer_ref is FTD until it has at least one SUCCESSFUL order with the
 * merchant; after that it's STD.
 */

const db = require('../models');

async function detectDepositType(merchantId, customerRef) {
  const previousSuccess = await db.Order.findOne({
    where: { merchant_id: merchantId, customer_ref: customerRef, status: 'success' },
  });
  return previousSuccess ? 'STD' : 'FTD';
}

async function validateDepositType(merchantId, customerRef, claimedType) {
  const detected = await detectDepositType(merchantId, customerRef);
  return {
    claimed: claimedType,
    detected,
    match: claimedType === detected,
    message:
      claimedType !== detected
        ? `Customer ${customerRef} is actually ${detected} but merchant sent ${claimedType}`
        : null,
  };
}

module.exports = { detectDepositType, validateDepositType };
