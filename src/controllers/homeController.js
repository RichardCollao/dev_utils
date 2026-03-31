const homeModel = require('../models/homeModel');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ROOT_UPLOADS_DIR,
  GLOBAL_FILE_NAME,
  ensureRootUploadsDir,
  migrateLegacyUploads,
  getUploadFilePath
} = require('../utils/uploadsStorage');

const GLOBAL_FILE_PATH = getUploadFilePath(GLOBAL_FILE_NAME);
const WORKSPACE_BASE_DIR = '/workspace';

const REQUIRED_GLOBAL_FIELDS = [
  'sonarToken',
  'sonarHostUrl',
  'sonarWorkingDirectory'
];

async function ensureUploadsDir() {
  await ensureRootUploadsDir();
  await migrateLegacyUploads();
}

function resolveWorkspacePath(storedPath = '') {
  const raw = String(storedPath || '').trim();
  if (!raw) return '';

  const withoutWorkspacePrefix = raw.startsWith('/workspace/')
    ? raw.slice('/workspace/'.length)
    : (raw === '/workspace' ? '' : raw);

  const cleanRelative = withoutWorkspacePrefix.replace(/^\/+/, '');
  const resolved = path.resolve(WORKSPACE_BASE_DIR, cleanRelative || '.');
  const isInsideWorkspace = resolved === WORKSPACE_BASE_DIR
    || resolved.startsWith(`${WORKSPACE_BASE_DIR}${path.sep}`);

  if (!isInsideWorkspace) {
    const error = new Error('La ruta debe estar dentro de /workspace.');
    error.status = 400;
    throw error;
  }

  return resolved;
}

function renderHome(req, res) {
  const data = homeModel.getHomeData();
  res.render('home', data);
}

async function getProjects(req, res) {
  try {
    await ensureUploadsDir();

    const entries = await fs.readdir(ROOT_UPLOADS_DIR, { withFileTypes: true });
    const jsonFiles = entries
      .filter(function(entry) { return entry.isFile() && entry.name.toLowerCase().endsWith('.json') && entry.name !== GLOBAL_FILE_NAME; })
      .map(function(entry) { return entry.name; });

    const projects = await Promise.all(jsonFiles.map(async function(fileName) {
      const fullPath = getUploadFilePath(fileName);
      const raw = await fs.readFile(fullPath, 'utf8');
      const data = JSON.parse(raw);
      return {
        fileName,
        sonarProjectKey: data.sonarProjectKey || path.basename(fileName, '.json'),
        sonarProjectBaseDir: data.sonarProjectBaseDir || ''
      };
    }));

    res.json({ success: true, data: projects });
  } catch (error) {
    console.error('Error listando proyectos:', error);
    res.status(500).json({ success: false, message: 'No fue posible listar los proyectos.' });
  }
}

async function getGlobalConfig(req, res) {
  try {
    await ensureUploadsDir();

    let data = {
      sonarToken: '',
      sonarHostUrl: '',
      sonarWorkingDirectory: ''
    };

    try {
      const raw = await fs.readFile(GLOBAL_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      data = {
        sonarToken: parsed.sonarToken || '',
        sonarHostUrl: parsed.sonarHostUrl || '',
        sonarWorkingDirectory: parsed.sonarWorkingDirectory || ''
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error obteniendo configuración global:', error);
    return res.status(500).json({ success: false, message: 'No fue posible obtener la configuración global.' });
  }
}

async function saveGlobalConfig(req, res) {
  try {
    const payload = req.body || {};
    const missing = REQUIRED_GLOBAL_FIELDS.filter(function(field) { return !payload[field] || !String(payload[field]).trim(); });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos globales requeridos: ${missing.join(', ')}`
      });
    }

    const data = {
      sonarToken: String(payload.sonarToken).trim(),
      sonarHostUrl: String(payload.sonarHostUrl || '').trim(),
      sonarWorkingDirectory: String(payload.sonarWorkingDirectory || '').trim()
    };

    await ensureUploadsDir();
    await fs.writeFile(GLOBAL_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');

    // Intentar crear sonarWorkingDirectory si no existe
    const warnings = [];
    const workingDir = data.sonarWorkingDirectory;
    if (workingDir) {
      const resolved = resolveWorkspacePath(workingDir);
      try {
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) {
          warnings.push(`La ruta '${resolved}' existe pero no es un directorio.`);
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') {
          try {
            await fs.mkdir(resolved, { recursive: true });
          } catch (mkdirError) {
            warnings.push(`No se pudo crear el directorio '${resolved}': ${mkdirError.message}`);
          }
        } else {
          warnings.push(`Error al verificar el directorio '${resolved}': ${statError.message}`);
        }
      }
    }

    const lowerHost = String(data.sonarHostUrl || '').trim().toLowerCase();
    if (
      lowerHost.startsWith('http://localhost')
      || lowerHost.startsWith('https://localhost')
      || lowerHost.startsWith('http://127.0.0.1')
      || lowerHost.startsWith('https://127.0.0.1')
      || lowerHost.startsWith('http://[::1]')
      || lowerHost.startsWith('https://[::1]')
    ) {
      warnings.push("En Docker, 'localhost' apunta al contenedor app. Se usará 'sonarqube' internamente para conectar con SonarQube.");
    }

    const warning = warnings.length > 0 ? warnings.join(' | ') : null;
    return res.json({ success: true, ...(warning && { warning }) });
  } catch (error) {
    console.error('Error guardando configuración global:', error);
    return res.status(500).json({ success: false, message: 'No fue posible guardar la configuración global.' });
  }
}

module.exports = {
  renderHome,
  getProjects,
  getGlobalConfig,
  saveGlobalConfig
};
