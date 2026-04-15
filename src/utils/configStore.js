const fs = require('node:fs/promises');
const path = require('node:path');
const {
  getWorkspaceBaseDir
} = require('./envConfig');

const WORKSPACE_BASE_DIR = getWorkspaceBaseDir();
const CONFIG_FILE_NAME = 'config.json';
const GLOBAL_CONFIG_DIR_RELATIVE = 'devutils/config';
const SONAR_CONFIG_DIR_RELATIVE = 'devutils/sonar';
const SEMGREP_CONFIG_DIR_RELATIVE = 'devutils/semgrep';

function resolveWorkspacePath(storedPath = '') {
  const raw = String(storedPath || '').trim();
  if (!raw) return '';

  let withoutWorkspacePrefix = raw;
  if (raw.startsWith(`${WORKSPACE_BASE_DIR}/`)) {
    withoutWorkspacePrefix = raw.slice(WORKSPACE_BASE_DIR.length + 1);
  } else if (raw === WORKSPACE_BASE_DIR) {
    withoutWorkspacePrefix = '';
  }

  const cleanRelative = withoutWorkspacePrefix.replace(/^\/+/, '');
  const resolved = path.resolve(WORKSPACE_BASE_DIR, cleanRelative || '.');
  const isInsideWorkspace = resolved === WORKSPACE_BASE_DIR
    || resolved.startsWith(`${WORKSPACE_BASE_DIR}${path.sep}`);

  if (!isInsideWorkspace) {
    const error = new Error(`La ruta debe estar dentro de ${WORKSPACE_BASE_DIR}.`);
    error.status = 400;
    throw error;
  }

  return resolved;
}

function normalizeDirectory(value = '') {
  let str = String(value || '').trim();
  if (str.startsWith(`${WORKSPACE_BASE_DIR}/`)) {
    str = str.slice(WORKSPACE_BASE_DIR.length + 1);
  } else if (str === WORKSPACE_BASE_DIR) {
    str = '';
  }
  return str.replace(/^\/+/, '');
}

function buildConfigFilePath(directoryRelative) {
  const cleanDirectory = normalizeDirectory(directoryRelative);

  if (!cleanDirectory) {
    const error = new Error('La ruta de configuración es obligatoria.');
    error.status = 400;
    throw error;
  }

  const absoluteDirectory = resolveWorkspacePath(cleanDirectory);
  return {
    directoryRelative: cleanDirectory,
    absoluteDirectory,
    filePath: path.join(absoluteDirectory, CONFIG_FILE_NAME)
  };
}

function normalizeSonarBundle(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const projects = Array.isArray(safe.projects) ? safe.projects : [];

  return {
    projects: projects
      .filter(function (item) {
        return item && typeof item === 'object';
      })
      .map(function (item) {
        const projectName = String(item.projectName || item.sonarProjectKey || '').trim();
        const projectBaseDir = String(item.projectBaseDir || item.sonarProjectBaseDir || '').trim();

        return {
          projectName,
          projectBaseDir
        };
      })
      .filter(function (item) {
        return !!item.projectName;
      })
  };
}

async function readRawBundleFromLocation(location) {
  try {
    const raw = await fs.readFile(location.filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function normalizeAppBundle(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  return {
    theme: ['light', 'dark'].includes(safe.theme) ? safe.theme : 'light'
  };
}

async function getBundle() {
  const mainLocation = buildConfigFilePath(GLOBAL_CONFIG_DIR_RELATIVE);

  let mainRaw;
  try {
    const raw = await fs.readFile(mainLocation.filePath, 'utf8');
    mainRaw = JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      mainRaw = {};
    } else {
      throw error;
    }
  }

  const baseBundle = normalizeSonarBundle(mainRaw);

  const sonarLocation = buildConfigFilePath(SONAR_CONFIG_DIR_RELATIVE);
  const sonarRaw = await readRawBundleFromLocation(sonarLocation);

  const semgrepLocation = buildConfigFilePath(SEMGREP_CONFIG_DIR_RELATIVE);
  const semgrepRaw = await readRawBundleFromLocation(semgrepLocation);

  const sonarTokenFromSonarConfig = String(sonarRaw.sonarToken || '').trim();
  const sonarToken = sonarTokenFromSonarConfig || '';

  const semgrepRulesFromSemgrepConfig =
    typeof semgrepRaw.semgrepRules === 'string' ? semgrepRaw.semgrepRules : '';
  const semgrepRules = semgrepRulesFromSemgrepConfig || '';

  const bundle = {
    sonarToken,
    semgrepRules,
    projects: baseBundle.projects
  };

  return { bundle, ...mainLocation };
}

async function writeBundle(bundleInput) {
  const safeInput = bundleInput && typeof bundleInput === 'object' ? bundleInput : {};
  const projects = Array.isArray(safeInput.projects)
    ? safeInput.projects
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item) {
        const projectName = String(item.projectName || item.sonarProjectKey || '').trim();
        const projectBaseDir = String(item.projectBaseDir || item.sonarProjectBaseDir || '').trim();

        return {
          projectName,
          projectBaseDir
        };
      })
      .filter(function (item) { return !!item.projectName; })
    : [];

  const sonarToken = String(safeInput.sonarToken || '').trim();
  const semgrepRules = typeof safeInput.semgrepRules === 'string' ? safeInput.semgrepRules : '';
  const mainLocation = buildConfigFilePath(GLOBAL_CONFIG_DIR_RELATIVE);
  const currentMainRaw = await readRawBundleFromLocation(mainLocation);
  const nextMainRaw = {
    ...(currentMainRaw && typeof currentMainRaw === 'object' ? currentMainRaw : {}),
    global: undefined,
    projects
  };

  await fs.mkdir(mainLocation.absoluteDirectory, { recursive: true });
  await fs.writeFile(mainLocation.filePath, JSON.stringify(nextMainRaw, null, 2), 'utf8');

  const sonarLocation = buildConfigFilePath(SONAR_CONFIG_DIR_RELATIVE);
  const currentSonarRaw = await readRawBundleFromLocation(sonarLocation);
  const nextSonarRaw = {
    ...(currentSonarRaw && typeof currentSonarRaw === 'object' ? currentSonarRaw : {}),
    sonarToken
  };

  await fs.mkdir(sonarLocation.absoluteDirectory, { recursive: true });
  await fs.writeFile(sonarLocation.filePath, JSON.stringify(nextSonarRaw, null, 2), 'utf8');

  const semgrepLocation = buildConfigFilePath(SEMGREP_CONFIG_DIR_RELATIVE);
  const currentSemgrepRaw = await readRawBundleFromLocation(semgrepLocation);
  const nextSemgrepRaw = {
    ...(currentSemgrepRaw && typeof currentSemgrepRaw === 'object' ? currentSemgrepRaw : {}),
    semgrepRules
  };

  await fs.mkdir(semgrepLocation.absoluteDirectory, { recursive: true });
  await fs.writeFile(semgrepLocation.filePath, JSON.stringify(nextSemgrepRaw, null, 2), 'utf8');

  const bundle = {
    sonarToken,
    semgrepRules,
    projects
  };

  return { bundle, ...mainLocation };
}

function getDefaultSonarWorkingDirectory() {
  return resolveWorkspacePath('devutils/sonar/temp');
}

async function getAppBundle() {
  const mainLocation = buildConfigFilePath(GLOBAL_CONFIG_DIR_RELATIVE);

  let raw;
  try {
    const text = await fs.readFile(mainLocation.filePath, 'utf8');
    raw = JSON.parse(text);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      bundle: normalizeAppBundle({}),
      absoluteDirectory: mainLocation.absoluteDirectory,
      filePath: mainLocation.filePath
    };
  }

  const appRaw = raw && typeof raw === 'object' && raw.app && typeof raw.app === 'object'
    ? raw.app
    : {};

  const bundle = normalizeAppBundle(appRaw);
  return { bundle, absoluteDirectory: mainLocation.absoluteDirectory, filePath: mainLocation.filePath };
}

async function writeAppBundle(appBundleInput) {
  const safeBundle = normalizeAppBundle(appBundleInput);
  const mainLocation = buildConfigFilePath(GLOBAL_CONFIG_DIR_RELATIVE);
  const currentMainRaw = await readRawBundleFromLocation(mainLocation);
  const baseMain = currentMainRaw && typeof currentMainRaw === 'object' ? currentMainRaw : {};

  const nextMainRaw = {
    ...baseMain,
    app: safeBundle
  };

  await fs.mkdir(mainLocation.absoluteDirectory, { recursive: true });
  await fs.writeFile(mainLocation.filePath, JSON.stringify(nextMainRaw, null, 2), 'utf8');

  return { bundle: safeBundle, absoluteDirectory: mainLocation.absoluteDirectory, filePath: mainLocation.filePath };
}

module.exports = {
  CONFIG_FILE_NAME,
  resolveWorkspacePath,
  getBundle,
  writeBundle,
  getDefaultSonarWorkingDirectory,
  getAppBundle,
  writeAppBundle
};
