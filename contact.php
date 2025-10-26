<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

$db = get_db();
$settings = $db->query('SELECT contact_email FROM settings WHERE id = 1')->fetch();
$recipient = $settings['contact_email'] ?? 'contact@cecileartiste.com';

$success = null;
$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim($_POST['name'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $subjectChoice = trim($_POST['subject'] ?? 'Autres');
    $message = trim($_POST['message'] ?? '');

    if ($name === '' || $email === '' || $message === '') {
        $error = "Merci de renseigner votre nom, email et message.";
    } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = "L'adresse email fournie n'est pas valide.";
    } else {
        $subject = "[Cécile'Artiste] " . $subjectChoice;
        $body = "Nom: {$name}\nEmail: {$email}\nObjet: {$subjectChoice}\n\nMessage:\n{$message}";
        $headers = "From: {$name} <{$email}>";

        if (@mail($recipient, $subject, $body, $headers)) {
            $success = "Merci ! Votre message a bien été envoyé.";
        } else {
            $error = "Une erreur est survenue lors de l'envoi. Merci de réessayer plus tard.";
        }
    }
}

include __DIR__ . '/templates/header.php';
?>
<section class="contact-section">
    <h1>Parlons de votre projet</h1>
    <p>Que ce soit pour imaginer un reportage coloré, un portrait lumineux ou raconter votre histoire, je suis à votre écoute. Partagez-moi vos envies et nous construirons ensemble une expérience photographique unique.</p>

    <?php if ($success): ?>
        <div class="notice"><?php echo htmlspecialchars($success); ?></div>
    <?php elseif ($error): ?>
        <div class="notice" role="alert"><?php echo htmlspecialchars($error); ?></div>
    <?php endif; ?>

    <form class="contact-form" method="post" action="">
        <div>
            <label for="name">Nom complet</label>
            <input type="text" id="name" name="name" required value="<?php echo htmlspecialchars($name ?? ''); ?>">
        </div>
        <div>
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required value="<?php echo htmlspecialchars($email ?? ''); ?>">
        </div>
        <div>
            <label for="subject">Objet</label>
            <select id="subject" name="subject">
                <?php
                $options = ['Demande de devis', 'Rendez-vous téléphonique', 'Autres'];
                $selectedSubject = $subjectChoice ?? 'Demande de devis';
                foreach ($options as $option):
                    $selected = ($selectedSubject === $option) ? 'selected' : '';
                ?>
                    <option value="<?php echo htmlspecialchars($option); ?>" <?php echo $selected; ?>><?php echo htmlspecialchars($option); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <div>
            <label for="message">Message</label>
            <textarea id="message" name="message" required><?php echo htmlspecialchars($message ?? ''); ?></textarea>
        </div>
        <button type="submit" class="button-primary">Envoyer</button>
    </form>
</section>
<?php
include __DIR__ . '/templates/footer.php';
