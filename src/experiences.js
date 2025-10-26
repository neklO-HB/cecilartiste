const { normalizePublicPath } = require('./utils');

function mapExperienceRow(row) {
  if (!row) {
    return row;
  }

  const { image_path: imagePath, ...rest } = row;

  return {
    ...rest,
    image_path: normalizePublicPath(imagePath),
  };
}

function getAllExperiences(db) {
  return db
    .prepare(
      'SELECT id, title, description, icon, image_path, position FROM experiences ORDER BY position ASC, id ASC'
    )
    .all()
    .map(mapExperienceRow);
}

function getNextPosition(db) {
  const { nextPosition } = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM experiences')
    .get();

  return Number.isInteger(nextPosition) ? nextPosition : 0;
}

function computePosition(db, rawPosition, fallbackPosition) {
  const parsed = Number.parseInt(rawPosition, 10);
  if (Number.isInteger(parsed)) {
    return parsed;
  }

  if (Number.isInteger(fallbackPosition)) {
    return fallbackPosition;
  }

  return getNextPosition(db);
}

function sanitizeExperiencePayload(payload = {}) {
  const {
    title = '',
    description = '',
    icon = '',
  } = payload;

  return {
    title: title.trim(),
    description: description.trim(),
    icon: icon.trim(),
  };
}

module.exports = {
  getAllExperiences,
  computePosition,
  sanitizeExperiencePayload,
  mapExperienceRow,
};
