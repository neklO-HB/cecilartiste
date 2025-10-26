const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'cecilartiste.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

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
  `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON contact_messages(created_at DESC)`
];

function prepareDatabase() {
  migrations.forEach(sql => {
    db.exec(sql);
  });

  db.prepare('INSERT OR IGNORE INTO settings (id, contact_email) VALUES (1, ?)').run(
    'contact@cecileartiste.com'
  );
}

db.function('lower_trim', (value = '') => String(value).trim().toLowerCase());
prepareDatabase();

module.exports = db;
module.exports.DB_PATH = dbPath;
module.exports.prepareDatabase = prepareDatabase;
