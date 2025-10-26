<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

$db = get_db();
$photos = $db->query('SELECT * FROM photos ORDER BY created_at DESC')->fetchAll();
$heroPhotos = array_slice($photos, 0, 6);

include __DIR__ . '/templates/header.php';
?>
<section class="hero">
    <div class="hero__intro">
        <h1>Capturer l'éclat de vos histoires</h1>
        <p>
            Bienvenue dans l'univers de Cécile'Artiste, photographe passionnée par les couleurs et les émotions.
            Je crée des expériences visuelles sur-mesure pour vos mariages, portraits et événements professionnels.
            Explorez mes séries et vivez l'énergie créative de chaque image.
        </p>
    </div>
    <div class="hero__mosaic">
        <?php if (!empty($heroPhotos)): ?>
            <?php foreach ($heroPhotos as $photo): ?>
                <figure>
                    <img src="<?php echo htmlspecialchars($photo['image_path']); ?>" alt="<?php echo htmlspecialchars($photo['title']); ?>">
                    <figcaption><?php echo htmlspecialchars($photo['title']); ?></figcaption>
                </figure>
            <?php endforeach; ?>
        <?php else: ?>
            <?php for ($i = 1; $i <= 6; $i++): ?>
                <figure>
                    <div class="placeholder" style="background: linear-gradient(135deg, var(--accent-color), var(--accent-secondary)); height: 140px;"></div>
                    <figcaption>Votre image ici</figcaption>
                </figure>
            <?php endfor; ?>
        <?php endif; ?>
    </div>
</section>

<section class="gallery-section">
    <div class="gallery-header">
        <h2>Collections Signature</h2>
        <p>Des instants en couleur, façonnés par la lumière. Faites défiler les séries pour découvrir le style de Cécile'Artiste et imaginez vos propres souvenirs capturés avec audace.</p>
    </div>
    <div class="gallery-grid">
        <?php if (!empty($photos)): ?>
            <?php foreach ($photos as $photo): ?>
                <article class="photo-card" style="--photo-accent: <?php echo htmlspecialchars($photo['accent_color'] ?: '#ff6f61'); ?>;">
                    <img src="<?php echo htmlspecialchars($photo['image_path']); ?>" alt="<?php echo htmlspecialchars($photo['title']); ?>">
                    <div class="photo-card__info">
                        <h3><?php echo htmlspecialchars($photo['title']); ?></h3>
                        <?php if (!empty($photo['description'])): ?>
                            <p><?php echo nl2br(htmlspecialchars($photo['description'])); ?></p>
                        <?php endif; ?>
                    </div>
                    <div class="photo-card__tags">
                        <span class="photo-card__tag">Palette <?php echo htmlspecialchars(ucfirst($photo['palette'])); ?></span>
                        <span class="photo-card__tag">Créée le <?php echo htmlspecialchars((new DateTime($photo['created_at']))->format('d/m/Y')); ?></span>
                    </div>
                </article>
            <?php endforeach; ?>
        <?php else: ?>
            <div class="notice">
                <strong>Votre galerie est prête&nbsp;!</strong> Ajoutez vos premières photos via l'espace d'administration pour révéler votre univers à vos visiteurs.
            </div>
        <?php endif; ?>
    </div>
</section>
<?php
include __DIR__ . '/templates/footer.php';
