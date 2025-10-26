const { hashPassword, HASH_PREFIX } = require('../src/passwords');
const db = require('../src/db');

async function main() {
  db.prepareDatabase();

  const targetUsername = 'Cecile';
  const adminUser = db
    .prepare(
      'SELECT id, password_hash FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))'
    )
    .get(targetUsername);

  const ensurePasswordFormat = user => {
    if (!user) {
      return;
    }
    if (!String(user.password_hash || '').startsWith(HASH_PREFIX)) {
      const passwordHash = hashPassword('Nicolas 0712!');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
      console.log(
        "Mot de passe administrateur mis à niveau vers le nouveau format de hachage."
      );
    }
  };

  if (!adminUser) {
    const legacyUser = db
      .prepare(
        'SELECT id, password_hash FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))'
      )
      .get('Cecil');

    if (legacyUser) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(targetUsername, legacyUser.id);
      console.log("Utilisateur d'administration renommé en 'Cecile'.");
      ensurePasswordFormat(legacyUser);
    } else {
      const passwordHash = hashPassword('Nicolas 0712!');
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
        targetUsername,
        passwordHash
      );
      console.log("Utilisateur d'administration créé.");
    }
  } else {
    ensurePasswordFormat(adminUser);
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
