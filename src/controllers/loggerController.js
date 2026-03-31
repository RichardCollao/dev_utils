const { logFrontend } = require('../utils/logger');

async function logClientEvent(req, res) {
  try {
    const payload = req.body || {};
    const level = String(payload.level || 'info').toLowerCase();
    const event = String(payload.event || 'frontend-event').trim() || 'frontend-event';

    await logFrontend(level, event, payload);
    return res.status(204).end();
  } catch (error) {
    console.error('Error guardando log frontend:', error);
    return res.status(500).json({ success: false, message: 'No fue posible guardar el log.' });
  }
}

module.exports = {
  logClientEvent
};
