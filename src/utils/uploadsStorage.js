const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT_UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const LEGACY_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const GLOBAL_FILE_NAME = 'global.json';

async function ensureRootUploadsDir() {
  await fs.mkdir(ROOT_UPLOADS_DIR, { recursive: true });
}

async function listLegacyJsonFiles() {
  let legacyEntries = [];

  try {
    legacyEntries = await fs.readdir(LEGACY_UPLOADS_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  return legacyEntries.filter(function(entry) {
    return entry.isFile() && entry.name.toLowerCase().endsWith('.json');
  });
}

async function rootFileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function moveLegacyFile(legacyFilePath, rootFilePath) {
  const exists = await rootFileExists(rootFilePath);

  if (!exists) {
    try {
      await fs.rename(legacyFilePath, rootFilePath);
      return;
    } catch (error) {
      if (error?.code !== 'EXDEV') {
        throw error;
      }

      await fs.copyFile(legacyFilePath, rootFilePath);
    }
  }

  await fs.unlink(legacyFilePath);
}

async function removeLegacyUploadsDirIfEmpty() {
  const remainingEntries = await fs.readdir(LEGACY_UPLOADS_DIR, { withFileTypes: true });
  const remainingFiles = remainingEntries.filter(function(entry) {
    return entry.isFile();
  });

  if (remainingFiles.length === 0) {
    await fs.rmdir(LEGACY_UPLOADS_DIR);
  }
}

async function migrateLegacyUploads() {
  await ensureRootUploadsDir();
  const jsonFiles = await listLegacyJsonFiles();

  if (jsonFiles.length === 0) {
    return;
  }

  for (const entry of jsonFiles) {
    const legacyFilePath = path.join(LEGACY_UPLOADS_DIR, entry.name);
    const rootFilePath = path.join(ROOT_UPLOADS_DIR, entry.name);
    await moveLegacyFile(legacyFilePath, rootFilePath);
  }

  await removeLegacyUploadsDirIfEmpty();
}

function getUploadFilePath(fileName) {
  return path.join(ROOT_UPLOADS_DIR, fileName);
}

module.exports = {
  ROOT_UPLOADS_DIR,
  GLOBAL_FILE_NAME,
  ensureRootUploadsDir,
  migrateLegacyUploads,
  getUploadFilePath
};
