const { hashPassword, HASH_PREFIX } = require('../src/passwords');
const db = require('../src/db');

async function main() {
  db.prepareDatabase();

  const adminUser = db
    .prepare(
      'SELECT id, password_hash FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))'
    )
    .get('Cecile');

  if (!adminUser) {
    const passwordHash = hashPassword('Nicolas 0712!');
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('Cecile', passwordHash);
    console.log("Utilisateur d'administration créé.");
  } else if (!String(adminUser.password_hash || '').startsWith(HASH_PREFIX)) {
    const passwordHash = hashPassword('Nicolas 0712!');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, adminUser.id);
    console.log("Mot de passe administrateur mis à niveau vers le nouveau format de hachage.");
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
