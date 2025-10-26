<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

$dbPath = DB_PATH;
$dir = dirname($dbPath);
if (!is_dir($dir)) {
    mkdir($dir, 0775, true);
}

$db = get_db();

$db->exec('CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)');

$db->exec('CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    image_path TEXT NOT NULL,
    palette TEXT DEFAULT "vibrant",
    accent_color TEXT DEFAULT "#ff6f61",
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)');

$db->exec('CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contact_email TEXT NOT NULL
)');

$stmt = $db->prepare('SELECT COUNT(*) AS count FROM users WHERE username = :username');
$stmt->execute([':username' => 'Cecile']);
$exists = (int) $stmt->fetchColumn();

if ($exists === 0) {
    $passwordHash = password_hash('Nicolas 0712!', PASSWORD_DEFAULT);
    $insertUser = $db->prepare('INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)');
    $insertUser->execute([
        ':username' => 'Cecile',
        ':password_hash' => $passwordHash,
    ]);
    echo "Utilisateur d'administration créé.\n";
} else {
    echo "Utilisateur d'administration déjà existant.\n";
}

$settingsExists = (int) $db->query('SELECT COUNT(*) FROM settings')->fetchColumn();
if ($settingsExists === 0) {
    $db->exec("INSERT INTO settings (id, contact_email) VALUES (1, 'contact@cecileartiste.com')");
    echo "Adresse email de contact initialisée.\n";
} else {
    echo "Adresse email de contact déjà initialisée.\n";
}

echo "Base de données prête.\n";
