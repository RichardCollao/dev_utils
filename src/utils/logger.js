const fs = require('node:fs/promises');
const path = require('node:path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILES = {
  app: path.join(LOGS_DIR, 'app.log'),
  frontend: path.join(LOGS_DIR, 'frontend.log')
};

async function ensureLogsDir() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
}

function normalizeData(data) {
  if (data === undefined) return '';

  if (typeof data === 'string') {
    return data;
  }

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function writeLog(target, level, message, data) {
  const filePath = LOG_FILES[target] || LOG_FILES.app;
  const timestamp = new Date().toISOString();
  const detail = normalizeData(data);
  const line = detail
    ? `[${timestamp}] [${String(level || 'info').toUpperCase()}] ${message} ${detail}\n`
    : `[${timestamp}] [${String(level || 'info').toUpperCase()}] ${message}\n`;

  await ensureLogsDir();
  await fs.appendFile(filePath, line, 'utf8');
}

function logApp(level, message, data) {
  return writeLog('app', level, message, data);
}

function logFrontend(level, message, data) {
  return writeLog('frontend', level, message, data);
}

module.exports = {
  LOGS_DIR,
  LOG_FILES,
  logApp,
  logFrontend
};
