<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

$db = get_db();

if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: /admin.php');
    exit;
}

$loginError = null;

if (!is_logged_in()) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $username = trim($_POST['username'] ?? '');
        $password = $_POST['password'] ?? '';

        $stmt = $db->prepare('SELECT * FROM users WHERE username = :username');
        $stmt->execute([':username' => $username]);
        $user = $stmt->fetch();

        if ($user && password_verify($password, $user['password_hash'])) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            header('Location: /admin.php');
            exit;
        } else {
            $loginError = 'Identifiants invalides. Merci de réessayer.';
        }
    }

    include __DIR__ . '/templates/header.php';
    ?>
    <div class="login-wrapper">
        <h1>Espace administration</h1>
        <p>Connectez-vous pour gérer votre portfolio et vos messages.</p>
        <?php if ($loginError): ?>
            <div class="notice" role="alert"><?php echo htmlspecialchars($loginError); ?></div>
        <?php endif; ?>
        <form method="post" class="admin-form">
            <div>
                <label for="username">Nom d'utilisateur</label>
                <input type="text" id="username" name="username" required>
            </div>
            <div>
                <label for="password">Mot de passe</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" class="button-primary">Se connecter</button>
        </form>
    </div>
    <?php
    include __DIR__ . '/templates/footer.php';
    exit;
}

$feedback = null;
$errors = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    try {
        switch ($action) {
            case 'add_photo':
                $title = trim($_POST['title'] ?? '');
                $description = trim($_POST['description'] ?? '');
                $palette = trim($_POST['palette'] ?? 'vibrant');
                $accentColor = trim($_POST['accent_color'] ?? '#ff6f61');

                if ($title === '' || empty($_FILES['photo']['name'])) {
                    throw new RuntimeException('Le titre et l\'image sont requis pour ajouter une photo.');
                }

                $uploadDir = ensure_upload_dir();
                $file = $_FILES['photo'];
                if (!is_uploaded_file($file['tmp_name'])) {
                    throw new RuntimeException('Échec du téléchargement du fichier.');
                }

                $mime = mime_content_type($file['tmp_name']);
                $allowed = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/gif' => '.gif', 'image/webp' => '.webp'];
                if (!isset($allowed[$mime])) {
                    throw new RuntimeException('Format d\'image non supporté. Formats autorisés : JPG, PNG, GIF, WEBP.');
                }

                $filename = uniqid('photo_', true) . $allowed[$mime];
                $destination = $uploadDir . '/' . $filename;
                if (!move_uploaded_file($file['tmp_name'], $destination)) {
                    throw new RuntimeException('Impossible d\'enregistrer l\'image sur le serveur.');
                }

                $relativePath = '/public/uploads/' . $filename;
                $stmt = $db->prepare('INSERT INTO photos (title, description, image_path, palette, accent_color) VALUES (:title, :description, :image_path, :palette, :accent_color)');
                $stmt->execute([
                    ':title' => $title,
                    ':description' => $description,
                    ':image_path' => $relativePath,
                    ':palette' => $palette,
                    ':accent_color' => $accentColor,
                ]);

                $feedback = 'La photo a été ajoutée avec succès.';
                break;

            case 'update_photo':
                $photoId = (int) ($_POST['photo_id'] ?? 0);
                $title = trim($_POST['title'] ?? '');
                $description = trim($_POST['description'] ?? '');
                $palette = trim($_POST['palette'] ?? 'vibrant');
                $accentColor = trim($_POST['accent_color'] ?? '#ff6f61');

                if ($photoId <= 0 || $title === '') {
                    throw new RuntimeException('Photo introuvable ou titre manquant.');
                }

                $stmt = $db->prepare('SELECT image_path FROM photos WHERE id = :id');
                $stmt->execute([':id' => $photoId]);
                $existing = $stmt->fetch();
                if (!$existing) {
                    throw new RuntimeException('Photo inexistante.');
                }

                $imagePath = $existing['image_path'];

                if (!empty($_FILES['photo']['name'])) {
                    $uploadDir = ensure_upload_dir();
                    $file = $_FILES['photo'];
                    if (!is_uploaded_file($file['tmp_name'])) {
                        throw new RuntimeException('Échec du téléchargement du fichier.');
                    }

                    $mime = mime_content_type($file['tmp_name']);
                    $allowed = ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/gif' => '.gif', 'image/webp' => '.webp'];
                    if (!isset($allowed[$mime])) {
                        throw new RuntimeException('Format d\'image non supporté.');
                    }

                    $filename = uniqid('photo_', true) . $allowed[$mime];
                    $destination = $uploadDir . '/' . $filename;
                    if (!move_uploaded_file($file['tmp_name'], $destination)) {
                        throw new RuntimeException('Impossible d\'enregistrer l\'image sur le serveur.');
                    }
                    $imagePath = '/public/uploads/' . $filename;
                }

                $stmt = $db->prepare('UPDATE photos SET title = :title, description = :description, palette = :palette, accent_color = :accent_color, image_path = :image_path WHERE id = :id');
                $stmt->execute([
                    ':title' => $title,
                    ':description' => $description,
                    ':palette' => $palette,
                    ':accent_color' => $accentColor,
                    ':image_path' => $imagePath,
                    ':id' => $photoId,
                ]);

                $feedback = 'La photo a été mise à jour.';
                break;

            case 'delete_photo':
                $photoId = (int) ($_POST['photo_id'] ?? 0);
                if ($photoId <= 0) {
                    throw new RuntimeException('Photo introuvable.');
                }

                $stmt = $db->prepare('SELECT image_path FROM photos WHERE id = :id');
                $stmt->execute([':id' => $photoId]);
                $existing = $stmt->fetch();
                if ($existing) {
                    $filePath = __DIR__ . $existing['image_path'];
                    if (is_file($filePath)) {
                        @unlink($filePath);
                    }
                    $delete = $db->prepare('DELETE FROM photos WHERE id = :id');
                    $delete->execute([':id' => $photoId]);
                    $feedback = 'La photo a été supprimée.';
                }
                break;

            case 'update_email':
                $email = trim($_POST['contact_email'] ?? '');
                if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    throw new RuntimeException('Veuillez indiquer une adresse email valide.');
                }

                $exists = $db->query('SELECT COUNT(*) FROM settings WHERE id = 1')->fetchColumn();
                if ($exists) {
                    $stmt = $db->prepare('UPDATE settings SET contact_email = :email WHERE id = 1');
                    $stmt->execute([':email' => $email]);
                } else {
                    $stmt = $db->prepare('INSERT INTO settings (id, contact_email) VALUES (1, :email)');
                    $stmt->execute([':email' => $email]);
                }

                $feedback = 'Adresse email mise à jour.';
                break;
        }
    } catch (Throwable $e) {
        $errors[] = $e->getMessage();
    }
}

$photos = $db->query('SELECT * FROM photos ORDER BY created_at DESC')->fetchAll();
$settings = $db->query('SELECT contact_email FROM settings WHERE id = 1')->fetch();
$currentEmail = $settings['contact_email'] ?? 'contact@cecileartiste.com';

include __DIR__ . '/templates/header.php';
?>
<section class="admin-container">
    <header class="gallery-header">
        <div>
            <h1>Administration du portfolio</h1>
            <p>Connectée en tant que <?php echo htmlspecialchars($_SESSION['username'] ?? 'Cécile'); ?>. Gérez vos images et votre email de contact en toute simplicité.</p>
        </div>
        <a class="button-secondary" href="/admin.php?logout=1">Se déconnecter</a>
    </header>

    <?php if ($feedback): ?>
        <div class="notice"><?php echo htmlspecialchars($feedback); ?></div>
    <?php endif; ?>

    <?php if (!empty($errors)): ?>
        <?php foreach ($errors as $error): ?>
            <div class="notice" role="alert"><?php echo htmlspecialchars($error); ?></div>
        <?php endforeach; ?>
    <?php endif; ?>

    <div class="admin-grid">
        <section class="admin-card">
            <h2>Ajouter une nouvelle photo</h2>
            <form class="admin-form" method="post" enctype="multipart/form-data">
                <input type="hidden" name="action" value="add_photo">
                <div>
                    <label for="title">Titre</label>
                    <input type="text" id="title" name="title" required>
                </div>
                <div>
                    <label for="description">Description</label>
                    <textarea id="description" name="description" rows="4" placeholder="Décrivez l'histoire derrière cette image..."></textarea>
                </div>
                <div>
                    <label for="palette">Palette</label>
                    <select id="palette" name="palette">
                        <option value="vibrant">Vibrant</option>
                        <option value="aurora">Aurora</option>
                        <option value="nocturne">Nocturne</option>
                        <option value="solaire">Solaire</option>
                    </select>
                </div>
                <div>
                    <label for="accent_color">Couleur d'accent</label>
                    <input type="color" id="accent_color" name="accent_color" value="#ff6f61">
                </div>
                <div>
                    <label for="photo">Image</label>
                    <input type="file" id="photo" name="photo" accept="image/*" required>
                </div>
                <button type="submit" class="button-primary">Ajouter</button>
            </form>
        </section>

        <section class="admin-card">
            <h2>Paramètres de contact</h2>
            <form class="admin-form" method="post">
                <input type="hidden" name="action" value="update_email">
                <div>
                    <label for="contact_email">Email destinataire</label>
                    <input type="email" id="contact_email" name="contact_email" required value="<?php echo htmlspecialchars($currentEmail); ?>">
                </div>
                <button type="submit" class="button-primary">Mettre à jour</button>
            </form>
        </section>
    </div>

    <section class="admin-card">
        <h2>Vos photos</h2>
        <?php if (empty($photos)): ?>
            <p>Aucune photo pour le moment. Ajoutez vos œuvres pour les voir apparaître ici.</p>
        <?php else: ?>
            <div class="admin-photos">
                <?php foreach ($photos as $photo): ?>
                    <article class="admin-photo-item">
                        <img src="<?php echo htmlspecialchars($photo['image_path']); ?>" alt="<?php echo htmlspecialchars($photo['title']); ?>">
                        <div>
                            <h3><?php echo htmlspecialchars($photo['title']); ?></h3>
                            <?php if (!empty($photo['description'])): ?>
                                <p><?php echo nl2br(htmlspecialchars($photo['description'])); ?></p>
                            <?php endif; ?>
                            <form class="admin-form" method="post" enctype="multipart/form-data">
                                <input type="hidden" name="action" value="update_photo">
                                <input type="hidden" name="photo_id" value="<?php echo (int) $photo['id']; ?>">
                                <div>
                                    <label for="title_<?php echo (int) $photo['id']; ?>">Titre</label>
                                    <input type="text" id="title_<?php echo (int) $photo['id']; ?>" name="title" required value="<?php echo htmlspecialchars($photo['title']); ?>">
                                </div>
                                <div>
                                    <label for="description_<?php echo (int) $photo['id']; ?>">Description</label>
                                    <textarea id="description_<?php echo (int) $photo['id']; ?>" name="description" rows="3"><?php echo htmlspecialchars($photo['description']); ?></textarea>
                                </div>
                                <div>
                                    <label for="palette_<?php echo (int) $photo['id']; ?>">Palette</label>
                                    <select id="palette_<?php echo (int) $photo['id']; ?>" name="palette">
                                        <?php
                                        $palettes = ['vibrant' => 'Vibrant', 'aurora' => 'Aurora', 'nocturne' => 'Nocturne', 'solaire' => 'Solaire'];
                                        foreach ($palettes as $value => $label):
                                            $selected = $photo['palette'] === $value ? 'selected' : '';
                                        ?>
                                            <option value="<?php echo htmlspecialchars($value); ?>" <?php echo $selected; ?>><?php echo htmlspecialchars($label); ?></option>
                                        <?php endforeach; ?>
                                    </select>
                                </div>
                                <div>
                                    <label for="accent_<?php echo (int) $photo['id']; ?>">Couleur d'accent</label>
                                    <input type="color" id="accent_<?php echo (int) $photo['id']; ?>" name="accent_color" value="<?php echo htmlspecialchars($photo['accent_color'] ?: '#ff6f61'); ?>">
                                </div>
                                <div>
                                    <label for="photo_<?php echo (int) $photo['id']; ?>">Remplacer l'image</label>
                                    <input type="file" id="photo_<?php echo (int) $photo['id']; ?>" name="photo" accept="image/*">
                                </div>
                                <div class="admin-photo-actions">
                                    <button type="submit" class="button-secondary">Enregistrer</button>
                                </div>
                            </form>
                            <form class="admin-form admin-form--delete" method="post" onsubmit="return confirm('Supprimer cette photo ?');">
                                <input type="hidden" name="action" value="delete_photo">
                                <input type="hidden" name="photo_id" value="<?php echo (int) $photo['id']; ?>">
                                <button type="submit" class="button-danger">Supprimer</button>
                            </form>
                        </div>
                    </article>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </section>
</section>
<?php
include __DIR__ . '/templates/footer.php';
