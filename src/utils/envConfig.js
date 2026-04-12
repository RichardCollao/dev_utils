function getSonarHostUrl() {
  return String(process.env.sonarHostUrl || '').trim();
}

function getSonarWorkingDirectory() {
  return String(process.env.sonarWorkingDirectory || 'sonar/temp').trim();
}

function getSonarConfigPath() {
  return String(process.env.sonarConfigPath || 'sonar').trim();
}

function getSemgrepWorkingDirectory() {
  return String(process.env.semgrepWorkingDirectory || 'semgrep/temp').trim();
}

function getAppConfigDirectory() {
  return 'devutils';
}

function getWorkspaceBaseDir() {
  const value = String(process.env.workspaceBaseDir || '').trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error('La variable de entorno workspaceBaseDir es obligatoria.');
  }
  return value;
}

module.exports = {
  getSonarHostUrl,
  getSonarWorkingDirectory,
  getSonarConfigPath,
  getSemgrepWorkingDirectory,
  getAppConfigDirectory,
  getWorkspaceBaseDir
};