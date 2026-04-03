const fs = require('node:fs/promises');
const path = require('node:path');
const { logApp } = require('../utils/logger');
const { getGlobalSonarHostUrl } = require('../utils/envConfig');
const {
  GLOBAL_FILE_NAME,
  ensureRootUploadsDir,
  migrateLegacyUploads,
  getUploadFilePath
} = require('../utils/uploadsStorage');

const GLOBAL_FILE_PATH = getUploadFilePath(GLOBAL_FILE_NAME);

const REQUIRED_PROJECT_FIELDS = [
  'sonarProjectKey',
  'sonarProjectBaseDir'
];

function isValidProjectKeyForFileName(value = '') {
  const projectKey = String(value || '').trim();
  if (!projectKey) return false;
  if (projectKey.length > 400) return false;
  if (!/^[A-Za-z0-9._:-]+$/.test(projectKey)) return false;
  return /\D/.test(projectKey);
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function ensureUploadsDir() {
  await ensureRootUploadsDir();
  await migrateLegacyUploads();
}

async function getGlobalConfig() {
  return readJsonFile(GLOBAL_FILE_PATH);
}

function buildAuthHeader(sonarToken) {
  const token = String(sonarToken || '').trim();
  const credentials = Buffer.from(`${token}:`, 'utf8').toString('base64');
  return `Basic ${credentials}`;
}

function normalizeHostUrl(hostUrl) {
  return String(hostUrl || '').trim().replace(/\/+$/, '');
}

function resolveRuntimeSonarHostUrl(rawHostUrl) {
  const hostUrl = normalizeHostUrl(rawHostUrl);
  if (!hostUrl) return hostUrl;

  try {
    const parsed = new URL(hostUrl);
    const localhostNames = new Set(['localhost', '127.0.0.1', '::1']);

    if (localhostNames.has(String(parsed.hostname || '').toLowerCase())) {
      parsed.hostname = 'sonarqube';
      return parsed.toString().replace(/\/+$/, '');
    }

    return hostUrl;
  } catch {
    return hostUrl;
  }
}

async function postToSonarApi(sonarHostUrl, sonarToken, endpoint, payload = {}) {
  const host = normalizeHostUrl(sonarHostUrl);
  const url = new URL(`${host}${endpoint}`);
  console.log('[sonar] request', {
    endpoint,
    url: url.toString(),
    payload
  });
  await logApp('info', '[sonar] request', {
    endpoint,
    url: url.toString(),
    payload
  });

  const requestBody = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    requestBody.set(key, normalized);
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(sonarToken),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: requestBody
  });

  const contentType = response.headers.get('content-type') || '';
  const responseBody = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  console.log('[sonar] response', {
    endpoint,
    status: response.status,
    ok: response.ok,
    body: responseBody
  });
  await logApp('info', '[sonar] response', {
    endpoint,
    status: response.status,
    ok: response.ok,
    body: responseBody
  });

  if (!response.ok) {
    const error = new Error('SonarQube API request failed');
    error.status = response.status;
    error.body = responseBody;
    throw error;
  }

  return responseBody;
}

async function resolveConfig() {
  const globalConfig = await getGlobalConfig();

  const sonarHostUrl = resolveRuntimeSonarHostUrl(getGlobalSonarHostUrl());
  const sonarToken = String(globalConfig.sonarToken || '').trim();

  if (!sonarHostUrl || !sonarToken) {
    const error = new Error('Configuración global incompleta.');
    error.status = 400;
    throw error;
  }

  return { sonarHostUrl, sonarToken };
}

function extractSonarErrorMessage(body) {
  if (!body) return '';

  if (typeof body === 'string') {
    return body.trim();
  }

  if (Array.isArray(body.errors)) {
    const messages = body.errors
      .map(item => String(item?.msg || '').trim())
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(' | ');
    }
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message.trim();
  }

  return '';
}

function isSonarProjectNotFoundError(error) {
  if (!error?.status) return false;

  const message = extractSonarErrorMessage(error.body).toLowerCase();
  if (!message) return false;

  return message.includes('not found')
    || message.includes('does not exist')
    || message.includes('no existe');
}

function isSonarProjectAlreadyExistsError(error) {
  if (!error?.status) return false;

  const message = extractSonarErrorMessage(error.body).toLowerCase();
  if (!message) return false;

  return message.includes('already exists')
    || message.includes('similar key already exists')
    || message.includes('ya existe')
    || message.includes('clave similar ya existe');
}

function hasSameProjectKey(existingProject, projectKey) {
  const safeProject = existingProject || {};
  const existingKey = String(safeProject.sonarProjectKey || '').trim();

  return existingKey === projectKey;
}

function handleSonarError(res, error, operation) {
  if (error?.code === 'ENOENT') {
    return res.status(404).json({ success: false, message: 'Proyecto o configuración global no encontrados.' });
  }

  if (error?.status) {
    const sonarMessage = extractSonarErrorMessage(error.body);
    const message = sonarMessage
      ? `Error consultando SonarQube (${operation}): ${sonarMessage}`
      : `Error consultando SonarQube (${operation}).`;

    return res.status(error.status).json({
      success: false,
      message
    });
  }

  return res.status(500).json({ success: false, message: `No fue posible consultar SonarQube (${operation}).` });
}

async function createProject(req, res) {
  try {
    const payload = req.body || {};
    console.log('[createProject] incoming payload', payload);
    await logApp('info', '[createProject] incoming payload', payload);
    const missing = REQUIRED_PROJECT_FIELDS.filter(function(field) { return !payload[field] || !String(payload[field]).trim(); });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos requeridos: ${missing.join(', ')}`
      });
    }

    const projectKey = String(payload.sonarProjectKey || '').trim();
    const projectBaseDir = String(payload.sonarProjectBaseDir || '').trim();
    console.log('[createProject] normalized', { projectKey, projectBaseDir });
    await logApp('info', '[createProject] normalized', { projectKey, projectBaseDir });

    if (!isValidProjectKeyForFileName(projectKey)) {
      return res.status(400).json({
        success: false,
        message: 'sonarProjectKey inválido. Use solo letras, números, punto (.), guion (-), guion bajo (_) y dos puntos (:), con al menos un carácter no numérico.'
      });
    }

    await ensureUploadsDir();
    const fileName = `${projectKey}.json`;
    const fullPath = getUploadFilePath(fileName);

    let existingProject = null;

    try {
      existingProject = await readJsonFile(fullPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }

    if (existingProject) {
      if (hasSameProjectKey(existingProject, projectKey)) {
        return res.status(200).json({
          success: true,
          fileName,
          message: 'El proyecto ya existe localmente con la misma key.'
        });
      }

      return res.status(409).json({
        success: false,
        message: `Ya existe el archivo ${fileName} con una configuración distinta.`
      });
    }

    const { sonarHostUrl, sonarToken } = await resolveConfig();
    let warningMessage = '';

    try {
      await postToSonarApi(
        sonarHostUrl,
        sonarToken,
        '/api/projects/create',
        { project: projectKey, name: projectKey }
      );
    } catch (error) {
      if (!isSonarProjectAlreadyExistsError(error)) {
        throw error;
      }

      warningMessage = `El proyecto ${projectKey} ya existía en SonarQube; se creó solo la configuración local.`;
    }

    const projectData = {
      sonarProjectKey: projectKey,
      sonarProjectBaseDir: projectBaseDir
    };

    await fs.writeFile(fullPath, JSON.stringify(projectData, null, 2), 'utf8');

    console.log('[createProject] local file written', { fileName, fullPath });
    await logApp('info', '[createProject] local file written', { fileName, fullPath });

    return res.status(201).json({
      success: true,
      fileName,
      message: warningMessage || 'Proyecto creado correctamente.'
    });
  } catch (error) {
    console.error('Error creando proyecto:', error);
    await logApp('error', 'Error creando proyecto', {
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      body: error?.body,
      code: error?.code
    });
    return handleSonarError(res, error, 'crear proyecto');
  }
}

async function updateProject(req, res) {
  try {
    await ensureUploadsDir();

    const fileName = path.basename(req.params.fileName || '');
    if (!fileName.toLowerCase().endsWith('.json') || fileName === GLOBAL_FILE_NAME) {
      return res.status(400).json({ success: false, message: 'Archivo inválido.' });
    }

    const payload = req.body || {};
    const missing = REQUIRED_PROJECT_FIELDS.filter(function(field) { return !payload[field] || !String(payload[field]).trim(); });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos requeridos: ${missing.join(', ')}`
      });
    }

    const nextProjectKey = String(payload.sonarProjectKey || '').trim();
    const nextProjectBaseDir = String(payload.sonarProjectBaseDir || '').trim();

    if (!isValidProjectKeyForFileName(nextProjectKey)) {
      return res.status(400).json({
        success: false,
        message: 'sonarProjectKey inválido. Use solo letras, números, punto (.), guion (-), guion bajo (_) y dos puntos (:), con al menos un carácter no numérico.'
      });
    }

    const currentPath = getUploadFilePath(fileName);
    let existingProject;

    try {
      existingProject = await readJsonFile(currentPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return res.status(404).json({ success: false, message: 'Proyecto no encontrado.' });
      }
      throw error;
    }

    const currentProjectKey = String(existingProject?.sonarProjectKey || path.basename(fileName, '.json')).trim();
    const keyChanged = currentProjectKey !== nextProjectKey;

    let warningMessage = '';
    let targetFileName = fileName;
    let targetPath = currentPath;

    if (keyChanged) {
      targetFileName = `${nextProjectKey}.json`;
      targetPath = getUploadFilePath(targetFileName);

      if (targetFileName !== fileName) {
        try {
          await fs.access(targetPath);
          return res.status(409).json({
            success: false,
            message: `Ya existe un proyecto local con key ${nextProjectKey}.`
          });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      const { sonarHostUrl, sonarToken } = await resolveConfig();

      try {
        await postToSonarApi(
          sonarHostUrl,
          sonarToken,
          '/api/projects/update_key',
          { from: currentProjectKey, to: nextProjectKey }
        );
      } catch (error) {
        if (!isSonarProjectNotFoundError(error)) {
          throw error;
        }

        warningMessage = `El proyecto ${currentProjectKey} no existía en SonarQube; se actualizó solo la configuración local.`;
      }
    }

    const updatedProject = {
      sonarProjectKey: nextProjectKey,
      sonarProjectBaseDir: nextProjectBaseDir
    };

    await fs.writeFile(targetPath, JSON.stringify(updatedProject, null, 2), 'utf8');

    if (targetPath !== currentPath) {
      await fs.unlink(currentPath);
    }

    return res.json({
      success: true,
      fileName: targetFileName,
      message: warningMessage || 'Proyecto actualizado correctamente.'
    });
  } catch (error) {
    console.error('Error actualizando proyecto:', error);
    await logApp('error', 'Error actualizando proyecto', {
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      body: error?.body,
      code: error?.code
    });
    return handleSonarError(res, error, 'actualizar proyecto');
  }
}

async function deleteProject(req, res) {
  try {
    await ensureUploadsDir();
    const fileName = path.basename(req.params.fileName || '');
    console.log('[deleteProject] request', { fileName });
    await logApp('info', '[deleteProject] request', { fileName });

    if (!fileName.toLowerCase().endsWith('.json') || fileName === GLOBAL_FILE_NAME) {
      return res.status(400).json({ success: false, message: 'Archivo inválido.' });
    }

    const fullPath = getUploadFilePath(fileName);
    const projectData = await readJsonFile(fullPath);
    const projectKey = String(projectData?.sonarProjectKey || path.basename(fileName, '.json')).trim();
    console.log('[deleteProject] normalized', { fileName, projectKey, fullPath });
    await logApp('info', '[deleteProject] normalized', { fileName, projectKey, fullPath });

    if (!isValidProjectKeyForFileName(projectKey)) {
      return res.status(400).json({ success: false, message: 'Proyecto inválido.' });
    }

    const { sonarHostUrl, sonarToken } = await resolveConfig();

    let warningMessage = '';

    try {
      await postToSonarApi(
        sonarHostUrl,
        sonarToken,
        '/api/projects/delete',
        { project: projectKey }
      );
    } catch (error) {
      if (!isSonarProjectNotFoundError(error)) {
        throw error;
      }

      warningMessage = `El proyecto ${projectKey} no existía en SonarQube; se eliminó solo la configuración local.`;
    }

    await fs.unlink(fullPath);
    console.log('[deleteProject] local file deleted', { fileName, fullPath, warningMessage });
    await logApp('info', '[deleteProject] local file deleted', { fileName, fullPath, warningMessage });

    return res.json({ success: true, message: warningMessage || 'Proyecto eliminado correctamente.' });
  } catch (error) {
    console.error('Error eliminando proyecto:', error);
    await logApp('error', 'Error eliminando proyecto', {
      message: error?.message,
      stack: error?.stack,
      status: error?.status,
      body: error?.body,
      code: error?.code
    });
    return handleSonarError(res, error, 'eliminar proyecto');
  }
}

module.exports = {
  createProject,
  updateProject,
  deleteProject
};
