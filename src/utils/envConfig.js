function getGlobalSonarHostUrl() {
  return String(process.env.globalSonarHostUrl || '').trim();
}

module.exports = {
  getGlobalSonarHostUrl
};