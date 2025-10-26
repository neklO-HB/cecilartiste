const bcrypt = require('bcryptjs');
const db = require('../src/db');

async function main() {
  db.prepareDatabase();

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
