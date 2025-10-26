const path = require('path');
const fs = require('fs');
let DatabaseConstructor;
let usingBetterSqlite = false;

try {
  DatabaseConstructor = require('better-sqlite3');
  usingBetterSqlite = true;
} catch (error) {
  ({ DatabaseSync: DatabaseConstructor } = require('node:sqlite'));
}

const dbPath = path.join(__dirname, '..', 'data', 'cecilartiste.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseConstructor(dbPath);

function runPragma(statement) {
  if (usingBetterSqlite && typeof db.pragma === 'function') {
    db.pragma(statement);
  } else {
    db.exec(`PRAGMA ${statement}`);
  }
}

runPragma('journal_mode = WAL');
runPragma('busy_timeout = 5000');
runPragma('foreign_keys = ON');

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    image_path TEXT NOT NULL,
    palette TEXT DEFAULT 'vibrant',
    accent_color TEXT DEFAULT '#ff6f61',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    hero_image_path TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contact_email TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON contact_messages(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_position ON categories(position ASC, name ASC)`
];

function prepareDatabase() {
  migrations.forEach(sql => {
    db.exec(sql);
  });

  const photoColumns = db.prepare('PRAGMA table_info(photos)').all();
  const hasCategoryColumn = photoColumns.some(column => column.name === 'category_id');
  if (!hasCategoryColumn) {
    db.exec('ALTER TABLE photos ADD COLUMN category_id INTEGER REFERENCES categories(id)');
  }

  db.prepare('INSERT OR IGNORE INTO settings (id, contact_email) VALUES (1, ?)').run(
    'contact@cecilartiste.com'
  );

  const defaultCategories = [
    'Mariage',
    'Baptême',
    'Anniversaire',
    'Grossesse',
    'Nouveau-né',
    'Autres'
  ];

  defaultCategories.forEach((name, index) => {
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (!existing) {
      db.prepare(
        'INSERT INTO categories (name, description, position) VALUES (?, ?, ?)'
      ).run(
        name,
        `Personnalisez votre texte pour la catégorie ${name.toLowerCase()} depuis l\'espace d\'administration.`,
        index
      );
    }
  });
}

prepareDatabase();

module.exports = db;
module.exports.DB_PATH = dbPath;
module.exports.prepareDatabase = prepareDatabase;
