function getSonarHostUrl() {
  return String(process.env.sonarHostUrl || '').trim();
}

function getSemgrepWorkingDirectory() {
  return String(process.env.semgrepWorkingDirectory || 'devutils/semgrep/temp').trim();
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
  getSemgrepWorkingDirectory,
  getWorkspaceBaseDir
};