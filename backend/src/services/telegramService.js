'use strict';

/**
 * Telegram notifications. Uses the Bot API via global fetch (Node 18+).
 * If TELEGRAM_BOT_TOKEN is not configured, calls are logged and skipped so the
 * rest of the system keeps working in local/dev environments.
 */

const config = require('../config');
const logger = require('../utils/logger');

async function sendMessage(chatId, text) {
  if (!config.telegram.botToken || !chatId) {
    logger.info(`[telegram:skip] ${text.replace(/\n/g, ' ')}`);
    return { skipped: true };
  }
  try {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return { ok: res.ok };
  } catch (err) {
    logger.error('Telegram sendMessage failed', err);
    return { ok: false, error: err.message };
  }
}

/** Notify a trader that a payment was received against one of their orders. */
async function sendPayInNotification(trader, order, amount, senderName) {
  const text =
    `✅ <b>Payment received: ₹${amount}</b>\n` +
    `Order: <code>${order.uuid || order.id}</code>\n` +
    `From: ${senderName || 'Unknown'}`;
  return sendMessage(trader?.telegram_chat_id, text);
}

/** Broadcast an alert to the admin channel. */
async function sendAlertToAdmin(message) {
  return sendMessage(config.telegram.adminChatId, `🚨 <b>Admin Alert</b>\n${message}`);
}

module.exports = { sendMessage, sendPayInNotification, sendAlertToAdmin };
