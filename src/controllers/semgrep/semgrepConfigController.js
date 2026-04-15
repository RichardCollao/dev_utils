const fs = require('node:fs/promises');
const path = require('node:path');
const {
  getSemgrepWorkingDirectory
} = require('../../utils/envConfig');
const {
  getBundle,
  writeBundle
} = require('../../utils/configStore');

const DEFAULT_RULES_PATH = path.resolve(__dirname, '../../config/semgrep-default-rules.yaml');

function renderSemgrepConfig(req, res) {
  res.render('semgrep/semgrep_config');
}

async function readDefaultRules() {
  try {
    return await fs.readFile(DEFAULT_RULES_PATH, 'utf8');
  } catch {
    return 'rules: []\n';
  }
}

async function getGlobalConfig(req, res) {
  try {
    const { bundle } = await getBundle();
    const configuredRules = typeof bundle?.semgrepRules === 'string' ? bundle.semgrepRules : '';
    const semgrepRules = configuredRules.trim() ? configuredRules : await readDefaultRules();

    const data = {
      semgrepRules,
      semgrepWorkingDirectory: getSemgrepWorkingDirectory()
    };

    return res.json({ success: true, data });
  } catch {
    return res.status(500).json({ success: false, message: 'No fue posible obtener la configuración de Semgrep.' });
  }
}

async function getDefaultRules(req, res) {
  try {
    const rules = await readDefaultRules();
    return res.json({ success: true, data: { rules } });
  } catch {
    return res.status(500).json({ success: false, message: 'No fue posible cargar las reglas por defecto.' });
  }
}

async function saveGlobalConfig(req, res) {
  try {
    const payload = req.body || {};
    const { bundle } = await getBundle();

    const nextBundle = {
      sonarToken: bundle?.sonarToken || '',
      semgrepRules: typeof payload.semgrepRules === 'string' ? payload.semgrepRules : '',
      projects: Array.isArray(bundle?.projects) ? bundle.projects : []
    };

    await writeBundle(nextBundle);

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: 'No fue posible guardar la configuración de Semgrep.' });
  }
}

module.exports = {
  renderSemgrepConfig,
  getGlobalConfig,
  saveGlobalConfig,
  getDefaultRules,
  readDefaultRules
};
