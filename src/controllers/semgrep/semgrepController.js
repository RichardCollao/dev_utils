const { getWorkspaceBaseDir } = require('../../utils/envConfig');

function renderSemgrep(req, res) {
  res.render('semgrep/index', { workspaceBaseDir: getWorkspaceBaseDir() });
}

module.exports = {
  renderSemgrep
};
