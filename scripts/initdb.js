const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function main() {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    image_path TEXT NOT NULL,
    palette TEXT DEFAULT 'vibrant',
    accent_color TEXT DEFAULT '#ff6f61',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contact_email TEXT NOT NULL
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const existingUser = db
    .prepare('SELECT COUNT(*) AS count FROM users WHERE lower_trim(username) = lower_trim(?)')
    .get('Cecile');

  if (!existingUser || existingUser.count === 0) {
    const passwordHash = bcrypt.hashSync('Nicolas 0712!', 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('Cecile', passwordHash);
    console.log("Utilisateur d'administration créé.");
  } else {
    console.log("Utilisateur d'administration déjà existant.");
  }

  const settingsRow = db.prepare('SELECT COUNT(*) AS count FROM settings WHERE id = 1').get();
  if (!settingsRow || settingsRow.count === 0) {
    db.prepare('INSERT INTO settings (id, contact_email) VALUES (1, ?)').run('contact@cecileartiste.com');
    console.log('Adresse email de contact initialisée.');
  } else {
    console.log('Adresse email de contact déjà initialisée.');
  }

  console.log('Base de données prête.');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
