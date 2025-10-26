<?php
declare(strict_types=1);

const DB_PATH = __DIR__ . '/data/cecilartiste.sqlite';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

function get_db(): PDO {
    static $db = null;

    if ($db instanceof PDO) {
        return $db;
    }

    $db = new PDO('sqlite:' . DB_PATH);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec('PRAGMA foreign_keys = ON');

    return $db;
}

function is_logged_in(): bool {
    return isset($_SESSION['user_id']);
}

function require_login(): void {
    if (!is_logged_in()) {
        header('Location: /admin.php');
        exit;
    }
}

function ensure_upload_dir(): string {
    $uploadDir = __DIR__ . '/public/uploads';
    if (!is_dir($uploadDir)) {
        mkdir($uploadDir, 0775, true);
    }
    return $uploadDir;
}
