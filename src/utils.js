const path = require('path');
const fs = require('fs');
const escapeHtml = require('escape-html');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  return uploadDir;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('fr-FR').format(date);
}

function nl2br(value) {
  if (!value) {
    return '';
  }
  return escapeHtml(String(value)).replace(/\r?\n/g, '<br>');
}

function normalizePublicPath(value) {
  if (!value) {
    return value;
  }
  return value.replace(/^\/public\//, '/').replace(/\/\//g, '/');
}

function relativePublicPath(value) {
  if (!value) {
    return value;
  }
  return normalizePublicPath(value).replace(/^\/+/, '');
}

function deleteFileIfExists(relativePath) {
  if (!relativePath) {
    return;
  }
  const normalized = relativePublicPath(relativePath);
  const absolutePath = path.join(__dirname, '..', 'public', normalized);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

function slugify(value) {
  const base = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase();

  return base || '';
}

module.exports = {
  ensureUploadDir,
  formatDate,
  nl2br,
  normalizePublicPath,
  relativePublicPath,
  deleteFileIfExists,
  slugify,
};
