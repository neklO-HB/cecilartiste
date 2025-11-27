const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const db = require('./src/db');
const { verifyPassword } = require('./src/passwords');
const experiencesService = require('./src/experiences');
const {
  ensureUploadDir,
  formatDate,
  nl2br,
  deleteFileIfExists,
  normalizePublicPath,
  slugify,
} = require('./src/utils');
const mailer = require('./src/mailer');

const app = express();
const port = process.env.PORT || 3000;

const DEFAULT_HERO_IMAGE_URL =
  'https://i.postimg.cc/brcb2z8C/21314712-8c8f-4d76-829b-f9a4fc4ecb31.png';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Remove the default body size cap to avoid 413 errors behind reverse proxies.
// Set BODY_SIZE_LIMIT env var (e.g. "100mb") to enforce a specific limit if needed.
const BODY_SIZE_LIMIT = process.env.BODY_SIZE_LIMIT || Infinity;

app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
app.use(express.json({ limit: BODY_SIZE_LIMIT }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'cecilartiste-secret',
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;
  res.locals.formatDate = formatDate;
  res.locals.nl2br = nl2br;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const categorySlugStatement = db.prepare(
  'SELECT id FROM categories WHERE slug = ?'
);
const categorySlugConflictStatement = db.prepare(
  'SELECT id FROM categories WHERE slug = ? AND id <> ?'
);
const navCategoriesStatement = db.prepare(
  'SELECT id, name, slug FROM categories ORDER BY position ASC, name ASC'
);
const categoryBySlugStatement = db.prepare(
  'SELECT * FROM categories WHERE slug = ?'
);
const studioInsightsStatement = db.prepare(
  'SELECT id, stat_value, stat_caption, data_count, position FROM studio_insights ORDER BY position ASC, id ASC'
);
const studioInsightByIdStatement = db.prepare(
  'SELECT id FROM studio_insights WHERE id = ?'
);

function generateCategorySlug(name, excludeId = null) {
  const base = slugify(name) || 'categorie';
  let candidate = base;
  let suffix = 1;

  while (true) {
    const conflict = excludeId
      ? categorySlugConflictStatement.get(candidate, excludeId)
      : categorySlugStatement.get(candidate);
    if (!conflict) {
      return candidate;
    }
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

app.use((req, res, next) => {
  try {
    res.locals.navCategories = navCategoriesStatement
      .all()
      .filter(category => Boolean((category.slug || '').trim()));
    res.locals.currentPath = req.path;
    next();
  } catch (error) {
    next(error);
  }
});

function resolveHeroImageUrl(rawValue) {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return DEFAULT_HERO_IMAGE_URL;
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return DEFAULT_HERO_IMAGE_URL;
    }
    return parsed.toString();
  } catch (error) {
    return DEFAULT_HERO_IMAGE_URL;
  }
}

const allowedMimes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = ensureUploadDir();
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = allowedMimes.get(file.mimetype) || path.extname(file.originalname) || '.bin';
    const filename = `photo_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (allowedMimes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format d\'image non supporté. Formats autorisés : JPG, PNG, GIF, WEBP.'));
    }
  },
});

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
});

function photoUpload(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, err => {
      if (err) {
        req.session.flash = { errors: [err.message] };
        return res.redirect('/admin');
      }
      return next();
    });
  };
}

function photoUploadMultiple(field, maxCount = 20) {
  return (req, res, next) => {
    upload.array(field, maxCount)(req, res, err => {
      if (err) {
        req.session.flash = { errors: [err.message] };
        return res.redirect('/admin');
      }
      return next();
    });
  };
}

function optionalUpload(field, redirectHash = '') {
  return (req, res, next) => {
    upload.single(field)(req, res, err => {
      if (err) {
        req.session.flash = { errors: [err.message] };
        const anchor = redirectHash ? `#${redirectHash}` : '';
        return res.redirect(`/admin${anchor}`);
      }
      return next();
    });
  };
}

function uploadAndHandle(field, handler) {
  return (req, res, next) => {
    upload.single(field)(req, res, err => {
      if (err) {
        req.session.flash = { errors: [err.message] };
        return res.redirect('/admin#categories');
      }
      Promise.resolve(handler(req, res, next)).catch(next);
    });
  };
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { error: 'Merci de vous connecter pour accéder à cette page.' };
    return res.redirect('/admin');
  }
  return next();
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });

  entries.forEach(entry => {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      const destinationDir = path.dirname(destinationPath);
      fs.mkdirSync(destinationDir, { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
    }
  });
}

function runTar(args, options = {}) {
  return new Promise((resolve, reject) => {
    const tarProcess = spawn('tar', args, options);

    tarProcess.on('error', error => {
      reject(error);
    });

    tarProcess.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`La commande tar a échoué (code ${code}).`));
      }
    });
  });
}

function collectBackupData() {
  const photos = db
    .prepare(
      'SELECT id, title, description, image_path, palette, accent_color, category_id, created_at FROM photos ORDER BY id ASC'
    )
    .all()
    .map(photo => ({
      ...photo,
      image_path: normalizePublicPath(photo.image_path),
    }));

  const categories = db
    .prepare(
      'SELECT id, name, description, hero_image_path, position, slug, created_at FROM categories ORDER BY id ASC'
    )
    .all()
    .map(category => ({
      ...category,
      hero_image_path: normalizePublicPath(category.hero_image_path),
    }));

  const experiences = db
    .prepare(
      'SELECT id, title, description, icon, image_path, position, created_at FROM experiences ORDER BY id ASC'
    )
    .all()
    .map(experience => ({
      ...experience,
      image_path: normalizePublicPath(experience.image_path),
    }));

  const studioInsights = db
    .prepare(
      'SELECT id, stat_value, stat_caption, data_count, position, created_at FROM studio_insights ORDER BY id ASC'
    )
    .all();

  const settings =
    db
      .prepare(
        'SELECT contact_email, hero_intro_heading, hero_intro_subheading, hero_intro_body, hero_intro_image_url FROM settings WHERE id = 1'
      )
      .get() || {};

  const messages = db
    .prepare('SELECT id, name, email, subject, message, created_at FROM contact_messages ORDER BY id ASC')
    .all();

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    photos,
    categories,
    experiences,
    studio_insights: studioInsights,
    settings,
    messages,
  };
}

function ensureIntegerId(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Identifiant invalide rencontré dans la sauvegarde.");
  }
  return parsed;
}

function sanitizeNullableNumber(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed)) {
    return parsed;
  }
  return null;
}

function sanitizePosition(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : 0;
}

function replaceUploadsDirectory(source) {
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  const parentDir = path.dirname(uploadsDir);
  const backupName = `uploads-backup-${Date.now()}`;
  const backupDir = path.join(parentDir, backupName);
  let previousDirectory = null;

  if (fs.existsSync(uploadsDir)) {
    fs.renameSync(uploadsDir, backupDir);
    previousDirectory = backupDir;
  }

  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    if (source && fs.existsSync(source)) {
      copyDirectory(source, uploadsDir);
    }
    if (previousDirectory) {
      fs.rmSync(previousDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    if (fs.existsSync(uploadsDir)) {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
    if (previousDirectory && fs.existsSync(previousDirectory)) {
      fs.renameSync(previousDirectory, uploadsDir);
    }
    throw error;
  }
}

function applyBackupData(data, extractedRoot) {
  if (!data || typeof data !== 'object') {
    throw new Error('La sauvegarde fournie est invalide.');
  }

  const categories = Array.isArray(data.categories) ? data.categories : [];
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const experiences = Array.isArray(data.experiences) ? data.experiences : [];
  const studioInsights = Array.isArray(data.studio_insights) ? data.studio_insights : [];
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM photos').run();
    db.prepare('DELETE FROM categories').run();
    db.prepare('DELETE FROM experiences').run();
    db.prepare('DELETE FROM studio_insights').run();
    db.prepare('DELETE FROM contact_messages').run();
    if (settings) {
      db.prepare('DELETE FROM settings WHERE id = 1').run();
    }

    db.exec(
      "DELETE FROM sqlite_sequence WHERE name IN ('photos','categories','experiences','studio_insights','contact_messages')"
    );

    const insertCategory = db.prepare(
      'INSERT INTO categories (id, name, description, hero_image_path, position, slug, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    categories.forEach(category => {
      const id = ensureIntegerId(category.id);
      const name = String(category.name || '').trim();
      if (!name) {
        throw new Error('Une catégorie de la sauvegarde ne possède pas de nom.');
      }
      const slugValue = (category.slug || '').trim() || slugify(name);
      insertCategory.run(
        id,
        name,
        category.description || null,
        normalizePublicPath(category.hero_image_path) || null,
        sanitizePosition(category.position),
        slugValue,
        category.created_at || new Date().toISOString()
      );
    });

    const insertPhoto = db.prepare(
      'INSERT INTO photos (id, title, description, image_path, palette, accent_color, category_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    photos.forEach(photo => {
      const id = ensureIntegerId(photo.id);
      const title = String(photo.title || '').trim() || 'Photographie du portfolio';
      const imagePath = normalizePublicPath(photo.image_path);
      if (!imagePath) {
        throw new Error('Une photo de la sauvegarde ne contient pas de chemin d\'image.');
      }
      insertPhoto.run(
        id,
        title,
        photo.description || null,
        imagePath,
        photo.palette || 'vibrant',
        (photo.accent_color || '#ff6f61').trim() || '#ff6f61',
        sanitizeNullableNumber(photo.category_id),
        photo.created_at || new Date().toISOString()
      );
    });

    const insertExperience = db.prepare(
      'INSERT INTO experiences (id, title, description, icon, image_path, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    experiences.forEach(experience => {
      const id = ensureIntegerId(experience.id);
      const title = String(experience.title || '').trim();
      const description = String(experience.description || '').trim();
      if (!title || !description) {
        throw new Error('Une expérience de la sauvegarde est incomplète.');
      }
      insertExperience.run(
        id,
        title,
        description,
        experience.icon || null,
        normalizePublicPath(experience.image_path) || null,
        sanitizePosition(experience.position),
        experience.created_at || new Date().toISOString()
      );
    });

    const insertInsight = db.prepare(
      'INSERT INTO studio_insights (id, stat_value, stat_caption, data_count, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    studioInsights.forEach(insight => {
      const id = ensureIntegerId(insight.id);
      insertInsight.run(
        id,
        String(insight.stat_value || '').trim(),
        String(insight.stat_caption || '').trim(),
        sanitizePosition(insight.data_count),
        sanitizePosition(insight.position),
        insight.created_at || new Date().toISOString()
      );
    });

    const insertMessage = db.prepare(
      'INSERT INTO contact_messages (id, name, email, subject, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    messages.forEach(message => {
      const id = ensureIntegerId(message.id);
      insertMessage.run(
        id,
        String(message.name || '').trim(),
        String(message.email || '').trim(),
        String(message.subject || '').trim(),
        message.message || '',
        message.created_at || new Date().toISOString()
      );
    });

    if (settings) {
      db
        .prepare(
          'INSERT INTO settings (id, contact_email, hero_intro_heading, hero_intro_subheading, hero_intro_body, hero_intro_image_url) VALUES (1, ?, ?, ?, ?, ?)'
        )
        .run(
          (settings.contact_email || 'contact@cecilartiste.com').trim(),
          settings.hero_intro_heading || 'Qui suis-je ?',
          settings.hero_intro_subheading || 'Cécile, photographe professionnelle à Amiens',
          settings.hero_intro_body ||
            "Artiste photographe spécialisée dans les univers colorés, j’immortalise vos histoires à Amiens et partout où elles me portent.",
          resolveHeroImageUrl(settings.hero_intro_image_url)
        );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const uploadsSource = path.join(extractedRoot, 'uploads');
  replaceUploadsDirectory(uploadsSource);
}

function getStudioInsights() {
  return studioInsightsStatement.all().map(insight => {
    const parsedCount = Number.parseInt(insight.data_count, 10);
    return {
      ...insight,
      stat_value: (insight.stat_value || '').trim(),
      stat_caption: (insight.stat_caption || '').trim(),
      data_count: Number.isNaN(parsedCount) ? 0 : parsedCount,
    };
  });
}

app.get(
  '/',
  asyncHandler(async (req, res) => {
    const photos = db
      .prepare('SELECT * FROM photos ORDER BY created_at DESC')
      .all()
      .map(photo => ({ ...photo, image_path: normalizePublicPath(photo.image_path) }));
    const categories = db
      .prepare('SELECT * FROM categories ORDER BY position ASC, name ASC')
      .all()
      .map(category => ({
        ...category,
        hero_image_path: normalizePublicPath(category.hero_image_path),
      }));
    const experiences = experiencesService.getAllExperiences(db);
    const studioInsights = getStudioInsights();
    const heroSettings = db
      .prepare(
        'SELECT hero_intro_heading, hero_intro_subheading, hero_intro_body, hero_intro_image_url FROM settings WHERE id = 1'
      )
      .get();
    const heroIntro = {
      heading: heroSettings?.hero_intro_heading?.trim() || 'Qui suis-je ?',
      subheading:
        heroSettings?.hero_intro_subheading?.trim() ||
        'Cécile, photographe professionnelle à Amiens',
      body:
        heroSettings?.hero_intro_body?.trim() ||
        "Artiste photographe spécialisée dans les univers colorés, j’immortalise vos histoires à Amiens et partout où elles me portent. Reportages de mariages, portraits signature ou projets professionnels : je me déplace en France et à l’international pour créer des images lumineuses qui vous ressemblent.",
      image: resolveHeroImageUrl(heroSettings?.hero_intro_image_url),
    };
    res.render('index', {
      photos,
      categories,
      heroIntro,
      experiences,
      studioInsights,
    });
  })
);

app.get(
  '/galerie',
  asyncHandler(async (req, res) => {
    const categories = db
      .prepare(
        'SELECT id, name, description, hero_image_path, slug FROM categories ORDER BY position ASC, name ASC'
      )
      .all()
      .map(category => ({
        ...category,
        hero_image_path: normalizePublicPath(category.hero_image_path),
      }));

    const counts = db
      .prepare(
        'SELECT category_id, COUNT(*) AS total FROM photos WHERE category_id IS NOT NULL GROUP BY category_id'
      )
      .all();
    const totals = new Map(counts.map(row => [row.category_id, row.total]));

    const categoriesWithStats = categories.map(category => ({
      ...category,
      photo_count: totals.get(category.id) || 0,
    }));

    res.locals.isGalleryOverview = true;

    res.render('gallery/index', {
      categories: categoriesWithStats,
    });
  })
);

app.get(
  '/galerie/:slug',
  asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const category = categoryBySlugStatement.get(slug);

    if (!category) {
      res.status(404);
      return res.render('error', {
        message: "Cette galerie est introuvable.",
      });
    }

    const photos = db
      .prepare('SELECT * FROM photos WHERE category_id = ? ORDER BY created_at DESC')
      .all(category.id)
      .map(photo => ({
        ...photo,
        image_path: normalizePublicPath(photo.image_path),
      }));

    res.locals.activeCategorySlug = category.slug;

    res.render('gallery/category', {
      category: {
        ...category,
        hero_image_path: normalizePublicPath(category.hero_image_path),
        photo_count: photos.length,
      },
      photos,
    });
  })
);

app.get(
  '/contact',
  asyncHandler(async (req, res) => {
    const settings = db.prepare('SELECT contact_email FROM settings WHERE id = 1').get();
    const contactEmail = settings && settings.contact_email
      ? settings.contact_email.trim()
      : 'contact@cecilartiste.com';
    const { success = null, error = null, formData = {} } = res.locals.flash;
    res.render('contact', {
      contactEmail,
      success,
      error,
      formData: {
        name: '',
        email: '',
        subject: 'Demande de devis',
        message: '',
        ...formData,
      },
    });
  })
);

app.post(
  '/contact',
  asyncHandler(async (req, res) => {
    const { name = '', email = '', subject = 'Autres', message = '' } = req.body;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim() || 'Autres';
    const trimmedMessage = message.trim();

    const formData = {
      name: trimmedName,
      email: trimmedEmail,
      subject: trimmedSubject,
      message: trimmedMessage,
    };

    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      req.session.flash = {
        error: 'Merci de renseigner votre nom, email et message.',
        formData,
      };
      return res.redirect('/contact');
    }

    const emailRegex = /.+@.+\..+/;
    if (!emailRegex.test(trimmedEmail)) {
      req.session.flash = {
        error: "L'adresse email fournie n'est pas valide.",
        formData,
      };
      return res.redirect('/contact');
    }

    db.prepare(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)'
    ).run(trimmedName, trimmedEmail, trimmedSubject, trimmedMessage);

    const settings = db.prepare('SELECT contact_email FROM settings WHERE id = 1').get();
    const contactEmail = settings && settings.contact_email
      ? settings.contact_email.trim()
      : 'contact@cecilartiste.com';

    let successMessage = 'Merci ! Votre message a bien été enregistré. Je vous réponds rapidement.';
    const emailConfigured = mailer.isEmailConfigured();

    if (contactEmail && emailConfigured) {
      try {
        await mailer.sendContactNotification({
          to: contactEmail,
          name: trimmedName,
          email: trimmedEmail,
          subject: trimmedSubject,
          message: trimmedMessage,
        });
        successMessage = 'Merci ! Votre message a bien été envoyé. Je vous réponds rapidement.';
      } catch (error) {
        console.error("Échec de l'envoi de l'email de notification du formulaire de contact.", error);
        successMessage =
          "Merci ! Votre message a bien été enregistré, mais l'envoi de l'email a rencontré un problème. Je vous répondrai dès que possible.";
      }
    } else if (contactEmail && !emailConfigured) {
      console.warn(
        "Aucun serveur SMTP n'est configuré. Le message a été enregistré mais aucune notification par email n'a été envoyée."
      );
    }

    req.session.flash = {
      success: successMessage,
    };

    return res.redirect('/contact');
  })
);

app.get(
  '/admin',
  asyncHandler(async (req, res) => {
    if (!req.session.user) {
      const { error = null } = res.locals.flash;
      return res.render('admin/login', { loginError: error });
    }

    const photos = db
      .prepare('SELECT * FROM photos ORDER BY created_at DESC')
      .all()
      .map(photo => ({ ...photo, image_path: normalizePublicPath(photo.image_path) }));
    const categories = db
      .prepare('SELECT * FROM categories ORDER BY position ASC, name ASC')
      .all()
      .map(category => ({
        ...category,
        hero_image_path: normalizePublicPath(category.hero_image_path),
      }));
    const experiences = experiencesService.getAllExperiences(db);
    const studioInsights = getStudioInsights();
    const settings = db
      .prepare(
        'SELECT contact_email, hero_intro_heading, hero_intro_subheading, hero_intro_body, hero_intro_image_url FROM settings WHERE id = 1'
      )
      .get();
    const contactEmail = settings ? settings.contact_email : 'contact@cecilartiste.com';
    const heroIntro = {
      heading: settings?.hero_intro_heading?.trim() || 'Qui suis-je ?',
      subheading:
        settings?.hero_intro_subheading?.trim() || 'Cécile, photographe professionnelle à Amiens',
      body:
        settings?.hero_intro_body?.trim() ||
        "Artiste photographe spécialisée dans les univers colorés, j’immortalise vos histoires à Amiens et partout où elles me portent. Reportages de mariages, portraits signature ou projets professionnels : je me déplace en France et à l’international pour créer des images lumineuses qui vous ressemblent.",
      image: resolveHeroImageUrl(settings?.hero_intro_image_url),
    };
    const messages = db
      .prepare(
        'SELECT id, name, email, subject, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 20'
      )
      .all();
    const { success = null, errors = [] } = res.locals.flash;

    return res.render('admin/dashboard', {
      photos,
      categories,
      experiences,
      studioInsights,
      contactEmail,
      heroIntro,
      messages,
      feedback: success,
      errors,
    });
  })
);

app.get(
  '/admin/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cecilartiste-export-'));
    const archiveRootName = 'cecilartiste-backup';
    const archiveRoot = path.join(tempDir, archiveRootName);
    const archivePath = path.join(tempDir, `${archiveRootName}.tar.gz`);

    try {
      fs.mkdirSync(archiveRoot, { recursive: true });
      const backupData = collectBackupData();
      fs.writeFileSync(path.join(archiveRoot, 'data.json'), JSON.stringify(backupData, null, 2), 'utf8');

      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      if (fs.existsSync(uploadsDir)) {
        copyDirectory(uploadsDir, path.join(archiveRoot, 'uploads'));
      }

      await runTar(['-czf', archivePath, '-C', tempDir, archiveRootName]);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const downloadName = `cecilartiste-backup-${timestamp}.tar.gz`;

      await new Promise((resolve, reject) => {
        res.download(archivePath, downloadName, err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })
);

app.post(
  '/admin/import',
  requireAuth,
  backupUpload.single('backup'),
  asyncHandler(async (req, res) => {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      req.session.flash = { errors: ['Merci de sélectionner une sauvegarde à importer.'] };
      return res.redirect('/admin#backups');
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cecilartiste-import-'));
    const archiveRootName = 'cecilartiste-backup';

    try {
      const archivePath = path.join(tempDir, 'import.tar.gz');
      fs.writeFileSync(archivePath, req.file.buffer);
      const extractDir = path.join(tempDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });

      await runTar(['-xzf', archivePath, '-C', extractDir]);

      const extractedRoot = path.join(extractDir, archiveRootName);
      if (!fs.existsSync(extractedRoot)) {
        throw new Error("Le fichier transmis ne correspond pas à une sauvegarde Cecil'Artiste valide.");
      }

      const dataPath = path.join(extractedRoot, 'data.json');
      if (!fs.existsSync(dataPath)) {
        throw new Error('Le fichier data.json est introuvable dans la sauvegarde fournie.');
      }

      const rawData = fs.readFileSync(dataPath, 'utf8');
      let parsedData;
      try {
        parsedData = JSON.parse(rawData);
      } catch (error) {
        throw new Error('Le contenu de la sauvegarde est illisible (JSON invalide).');
      }

      applyBackupData(parsedData, extractedRoot);
      req.session.flash = { success: 'La sauvegarde a été importée avec succès.' };
    } catch (error) {
      console.error("Échec de l'import de sauvegarde :", error);
      req.session.flash = {
        errors: [
          error.message ||
            "La sauvegarde n’a pas pu être importée. Vérifiez le fichier et réessayez.",
        ],
      };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    return res.redirect('/admin#backups');
  })
);

app.post(
  '/admin/login',
  asyncHandler(async (req, res) => {
    const { username = '', password = '' } = req.body;
    const user = db
      .prepare(
        'SELECT id, username, password_hash FROM users WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))'
      )
      .get(username);

    if (user && verifyPassword(password, user.password_hash)) {
      req.session.user = { id: user.id, username: user.username };
      return res.redirect('/admin');
    }

    req.session.flash = { error: 'Identifiants invalides. Merci de réessayer.' };
    return res.redirect('/admin');
  })
);

app.post(
  '/admin/logout',
  asyncHandler(async (req, res) => {
    req.session.destroy(() => {
      res.redirect('/admin');
    });
  })
);

app.post(
  '/admin/photos',
  requireAuth,
  photoUploadMultiple('photos'),
  asyncHandler(async (req, res) => {
    const {
      description = '',
      accent_color = '#ff6f61',
      category_id: rawCategoryId = '',
    } = req.body;
    const errors = [];
    const files = Array.isArray(req.files) ? req.files : [];

    const categoryId = Number.parseInt(rawCategoryId, 10);
    let categoryValue = null;
    if (rawCategoryId) {
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        errors.push('La catégorie sélectionnée est invalide.');
      } else {
        const categoryExists = db
          .prepare('SELECT id FROM categories WHERE id = ?')
          .get(categoryId);
        if (!categoryExists) {
          errors.push('La catégorie sélectionnée est introuvable.');
        } else {
          categoryValue = categoryId;
        }
      }
    }

    if (!files.length) {
      errors.push('Merci de sélectionner une image à téléverser.');
    }

    if (errors.length > 0) {
      files.forEach(file => {
        if (file?.filename) {
          deleteFileIfExists(`/uploads/${file.filename}`);
        }
      });
      req.session.flash = { errors };
      return res.redirect('/admin#add-photo');
    }

    const sanitizedDescription = description.trim();
    const sanitizedAccent = accent_color.trim() || '#ff6f61';
    const insertStatement = db.prepare(
      'INSERT INTO photos (title, description, image_path, accent_color, category_id) VALUES (?, ?, ?, ?, ?)'
    );

    files.forEach((file, index) => {
      const relativePath = `/uploads/${file.filename}`;
      const baseName = path.parse(file.originalname || '').name.replace(/[_\s-]+/g, ' ').trim();
      const normalizedTitle = baseName || 'Photographie du portfolio';
      const photoTitle =
        files.length === 1 || index === 0
          ? normalizedTitle
          : `${normalizedTitle} (${index + 1})`;
      insertStatement.run(
        photoTitle,
        sanitizedDescription,
        relativePath,
        sanitizedAccent,
        categoryValue
      );
    });

    const successMessage =
      files.length > 1
        ? `${files.length} photos ont été ajoutées avec succès.`
        : 'La photo a été ajoutée avec succès.';

    req.session.flash = { success: successMessage };
    return res.redirect('/admin#add-photo');
  })
);

app.post(
  '/admin/photos/:id',
  requireAuth,
  photoUpload('photo'),
  asyncHandler(async (req, res) => {
    const photoId = Number.parseInt(req.params.id, 10);
    const {
      description = '',
      accent_color = '#ff6f61',
      category_id: rawCategoryId = '',
    } = req.body;
    const errors = [];

    if (!Number.isInteger(photoId) || photoId <= 0) {
      errors.push('Photo introuvable.');
    }

    const existing = db.prepare('SELECT image_path, title FROM photos WHERE id = ?').get(photoId);
    if (!existing) {
      errors.push('Photo inexistante.');
    }

    let categoryValue = null;
    if (rawCategoryId) {
      const categoryId = Number.parseInt(rawCategoryId, 10);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        errors.push('La catégorie sélectionnée est invalide.');
      } else {
        const categoryExists = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
        if (!categoryExists) {
          errors.push('La catégorie sélectionnée est introuvable.');
        } else {
          categoryValue = categoryId;
        }
      }
    }

    if (errors.length > 0) {
      if (req.file) {
        deleteFileIfExists(`/uploads/${req.file.filename}`);
      }
      req.session.flash = { errors };
      return res.redirect('/admin');
    }

    const fallbackTitle = existing?.title?.trim() || 'Photographie du portfolio';

    if (req.file) {
      const newPath = `/uploads/${req.file.filename}`;
      const derivedTitle = req.file.originalname
        ? path.parse(req.file.originalname).name.replace(/[_\s-]+/g, ' ').trim() || fallbackTitle
        : fallbackTitle;
      db
        .prepare('UPDATE photos SET title = ?, description = ?, accent_color = ?, category_id = ?, image_path = ? WHERE id = ?')
        .run(
          derivedTitle,
          description.trim(),
          accent_color.trim() || '#ff6f61',
          categoryValue,
          newPath,
          photoId
        );
      deleteFileIfExists(existing.image_path);
    } else {
      db
        .prepare('UPDATE photos SET title = ?, description = ?, accent_color = ?, category_id = ? WHERE id = ?')
        .run(
          fallbackTitle,
          description.trim(),
          accent_color.trim() || '#ff6f61',
          categoryValue,
          photoId
        );
    }

    req.session.flash = { success: 'La photo a été mise à jour.' };
    return res.redirect('/admin');
  })
);

app.post(
  '/admin/photos/:id/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const photoId = Number.parseInt(req.params.id, 10);
    const errors = [];

    if (!Number.isInteger(photoId) || photoId <= 0) {
      errors.push('Photo introuvable.');
    } else {
      const existing = db.prepare('SELECT image_path FROM photos WHERE id = ?').get(photoId);
      if (!existing) {
        errors.push('Photo inexistante.');
      } else {
        db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);
        deleteFileIfExists(existing.image_path);
      }
    }

    if (errors.length > 0) {
      req.session.flash = { errors };
    } else {
      req.session.flash = { success: 'La photo a été supprimée.' };
    }

    return res.redirect('/admin');
  })
);

app.post(
  '/admin/categories',
  requireAuth,
  uploadAndHandle('hero_image', async (req, res) => {
    const { name = '', position = '' } = req.body;
    const trimmedName = name.trim();
    const positionValue = Number.parseInt(position, 10);
    const errors = [];

    if (!trimmedName) {
      errors.push('Merci d\'indiquer un nom pour la catégorie.');
    } else {
      const existing = db
        .prepare('SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))')
        .get(trimmedName);
      if (existing) {
        errors.push('Une catégorie avec ce nom existe déjà.');
      }
    }

    if (!req.file) {
      errors.push('Merci de sélectionner une image de mise en avant.');
    }

    if (errors.length > 0) {
      if (req.file) {
        deleteFileIfExists(`/uploads/${req.file.filename}`);
      }
      req.session.flash = { errors };
      return res.redirect('/admin#categories');
    }

    const { next_position: nextPosition } = db
      .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM categories')
      .get();

    const finalPosition = Number.isInteger(positionValue) ? positionValue : nextPosition;
    const heroImagePath = `/uploads/${req.file.filename}`;

    const slug = generateCategorySlug(trimmedName);

    db.prepare(
      'INSERT INTO categories (name, description, hero_image_path, position, slug) VALUES (?, ?, ?, ?, ?)'
    ).run(trimmedName, null, heroImagePath, finalPosition, slug);

    req.session.flash = { success: 'Catégorie créée avec succès.' };
    return res.redirect('/admin#categories');
  })
);

app.post(
  '/admin/categories/:id',
  requireAuth,
  uploadAndHandle('hero_image', async (req, res) => {
    const categoryId = Number.parseInt(req.params.id, 10);
    const { name = '', position = '' } = req.body;
    const trimmedName = name.trim();
    const positionValue = Number.parseInt(position, 10);
    const errors = [];

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      errors.push('Catégorie introuvable.');
    }

    const existing = Number.isInteger(categoryId)
      ? db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId)
      : null;
    if (!existing) {
      errors.push('Catégorie inexistante.');
    }

    if (!trimmedName) {
      errors.push('Merci d\'indiquer un nom pour la catégorie.');
    } else {
      const conflict = db
        .prepare(
          'SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id <> ?'
        )
        .get(trimmedName, categoryId);
      if (conflict) {
        errors.push('Une autre catégorie porte déjà ce nom.');
      }
    }

    if (errors.length > 0) {
      if (req.file) {
        deleteFileIfExists(`/uploads/${req.file.filename}`);
      }
      req.session.flash = { errors };
      return res.redirect('/admin#categories');
    }

    const finalPosition = Number.isInteger(positionValue) ? positionValue : existing.position;
    const heroImagePath = req.file ? `/uploads/${req.file.filename}` : existing.hero_image_path;
    const existingSlug = (existing && existing.slug) || null;
    const slug = existingSlug && trimmedName === existing.name
      ? existingSlug
      : generateCategorySlug(trimmedName, categoryId);

    db.prepare(
      'UPDATE categories SET name = ?, description = ?, hero_image_path = ?, position = ?, slug = ? WHERE id = ?'
    ).run(trimmedName, null, heroImagePath, finalPosition, slug, categoryId);

    if (req.file && existing.hero_image_path && existing.hero_image_path !== heroImagePath) {
      deleteFileIfExists(existing.hero_image_path);
    }

    req.session.flash = { success: 'Catégorie mise à jour.' };
    return res.redirect('/admin#categories');
  })
);

app.post(
  '/admin/categories/:id/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const categoryId = Number.parseInt(req.params.id, 10);
    const errors = [];

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      errors.push('Catégorie introuvable.');
    } else {
      const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
      if (!existing) {
        errors.push('Catégorie inexistante.');
      } else {
        db.prepare('UPDATE photos SET category_id = NULL WHERE category_id = ?').run(categoryId);
        db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
        if (existing.hero_image_path) {
          deleteFileIfExists(existing.hero_image_path);
        }
      }
    }

    if (errors.length > 0) {
      req.session.flash = { errors };
    } else {
      req.session.flash = { success: 'Catégorie supprimée.' };
    }

    return res.redirect('/admin#categories');
  })
);

app.post(
  '/admin/experiences',
  requireAuth,
  optionalUpload('image', 'experiences'),
  asyncHandler(async (req, res) => {
    const { position: rawPosition = '' } = req.body;
    const {
      title: trimmedTitle,
      description: trimmedDescription,
      icon: trimmedIcon,
    } = experiencesService.sanitizeExperiencePayload(req.body);
    const hasImage = Boolean(req.file);
    const newImagePath = hasImage ? `/uploads/${req.file.filename}` : null;
    const errors = [];

    if (!trimmedTitle) {
      errors.push("Le titre de l'expérience est requis.");
    }

    if (!trimmedDescription) {
      errors.push("La description de l'expérience est requise.");
    }

    if (!trimmedIcon && !hasImage) {
      errors.push("Ajoutez une icône ou une image pour l'expérience.");
    }

    const positionValue = experiencesService.computePosition(db, rawPosition);

    if (errors.length > 0) {
      if (newImagePath) {
        deleteFileIfExists(newImagePath);
      }
      req.session.flash = { errors };
      return res.redirect('/admin#experiences');
    }

    db.prepare(
      'INSERT INTO experiences (title, description, icon, image_path, position) VALUES (?, ?, ?, ?, ?)'
    ).run(trimmedTitle, trimmedDescription, trimmedIcon || null, newImagePath, positionValue);

    req.session.flash = { success: "L'expérience a été ajoutée avec succès." };
    return res.redirect('/admin#experiences');
  })
);

app.post(
  '/admin/experiences/:id',
  requireAuth,
  optionalUpload('image', 'experiences'),
  asyncHandler(async (req, res) => {
    const experienceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(experienceId)) {
      req.session.flash = { errors: ["L'expérience demandée est introuvable."] };
      return res.redirect('/admin#experiences');
    }

    const existing = db
      .prepare('SELECT id, image_path, position FROM experiences WHERE id = ?')
      .get(experienceId);

    if (!existing) {
      req.session.flash = { errors: ["L'expérience demandée est introuvable."] };
      return res.redirect('/admin#experiences');
    }

    const {
      position: rawPosition = '',
      remove_image: removeImage = 'off',
    } = req.body;
    const {
      title: trimmedTitle,
      description: trimmedDescription,
      icon: trimmedIcon,
    } = experiencesService.sanitizeExperiencePayload(req.body);
    const hasNewImage = Boolean(req.file);
    const uploadedImagePath = hasNewImage ? `/uploads/${req.file.filename}` : null;
    const willRemoveImage = removeImage === 'on';
    const errors = [];

    if (!trimmedTitle) {
      errors.push("Le titre de l'expérience est requis.");
    }

    if (!trimmedDescription) {
      errors.push("La description de l'expérience est requise.");
    }

    let finalImagePath = existing.image_path;
    if (hasNewImage) {
      finalImagePath = uploadedImagePath;
    } else if (willRemoveImage) {
      finalImagePath = null;
    }

    if (!trimmedIcon && !finalImagePath) {
      errors.push("Ajoutez une icône ou une image pour l'expérience.");
    }

    const positionValue = experiencesService.computePosition(db, rawPosition, existing.position);

    if (errors.length > 0) {
      if (uploadedImagePath) {
        deleteFileIfExists(uploadedImagePath);
      }
      req.session.flash = { errors };
      return res.redirect('/admin#experiences');
    }

    db.prepare(
      'UPDATE experiences SET title = ?, description = ?, icon = ?, image_path = ?, position = ? WHERE id = ?'
    ).run(trimmedTitle, trimmedDescription, trimmedIcon || null, finalImagePath, positionValue, experienceId);

    if (hasNewImage && existing.image_path && existing.image_path !== finalImagePath) {
      deleteFileIfExists(existing.image_path);
    } else if (willRemoveImage && existing.image_path) {
      deleteFileIfExists(existing.image_path);
    }

    req.session.flash = { success: "L'expérience a été mise à jour." };
    return res.redirect('/admin#experiences');
  })
);

app.post(
  '/admin/experiences/:id/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const experienceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(experienceId)) {
      req.session.flash = { errors: ["L'expérience demandée est introuvable."] };
      return res.redirect('/admin#experiences');
    }

    const existing = db
      .prepare('SELECT image_path FROM experiences WHERE id = ?')
      .get(experienceId);

    if (!existing) {
      req.session.flash = { errors: ["L'expérience demandée est introuvable."] };
      return res.redirect('/admin#experiences');
    }

    db.prepare('DELETE FROM experiences WHERE id = ?').run(experienceId);

    if (existing.image_path) {
      deleteFileIfExists(existing.image_path);
    }

    req.session.flash = { success: "L'expérience a été supprimée." };
    return res.redirect('/admin#experiences');
  })
);

app.post(
  '/admin/studio-insights',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      stat_value: rawValue = '',
      stat_caption: rawCaption = '',
      data_count: rawCount = '',
      position: rawPosition = '',
    } = req.body;

    const errors = [];
    const statValue = rawValue.trim();
    const statCaption = rawCaption.trim();

    if (!statValue) {
      errors.push('Merci de renseigner la valeur à afficher.');
    }

    if (!statCaption) {
      errors.push('Merci de renseigner la description de votre statistique.');
    }

    if (errors.length > 0) {
      req.session.flash = { errors };
      return res.redirect('/admin#studio-insights');
    }

    const parsedCount = Number.parseInt(rawCount, 10);
    const fallbackCount = Number.parseInt(statValue.replace(/[^0-9]/g, ''), 10);
    const dataCount = Number.isNaN(parsedCount)
      ? Number.isNaN(fallbackCount)
        ? 0
        : fallbackCount
      : Math.max(parsedCount, 0);
    const parsedPosition = Number.parseInt(rawPosition, 10);
    const position = Number.isNaN(parsedPosition) ? 0 : parsedPosition;

    db.prepare(
      'INSERT INTO studio_insights (stat_value, stat_caption, data_count, position) VALUES (?, ?, ?, ?)'
    ).run(statValue, statCaption, dataCount, position);

    req.session.flash = { success: 'La statistique a été ajoutée avec succès.' };
    return res.redirect('/admin#studio-insights');
  })
);

app.post(
  '/admin/studio-insights/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const insightId = Number.parseInt(req.params.id, 10);
    const {
      stat_value: rawValue = '',
      stat_caption: rawCaption = '',
      data_count: rawCount = '',
      position: rawPosition = '',
    } = req.body;
    const errors = [];

    if (!Number.isInteger(insightId) || insightId <= 0) {
      errors.push('Statistique introuvable.');
    }

    const existing = studioInsightByIdStatement.get(insightId);
    if (!existing) {
      errors.push('Cette statistique est introuvable.');
    }

    const statValue = rawValue.trim();
    const statCaption = rawCaption.trim();

    if (!statValue) {
      errors.push('Merci de renseigner la valeur à afficher.');
    }

    if (!statCaption) {
      errors.push('Merci de renseigner la description de votre statistique.');
    }

    if (errors.length > 0) {
      req.session.flash = { errors };
      return res.redirect('/admin#studio-insights');
    }

    const parsedCount = Number.parseInt(rawCount, 10);
    const fallbackCount = Number.parseInt(statValue.replace(/[^0-9]/g, ''), 10);
    const dataCount = Number.isNaN(parsedCount)
      ? Number.isNaN(fallbackCount)
        ? 0
        : fallbackCount
      : Math.max(parsedCount, 0);
    const parsedPosition = Number.parseInt(rawPosition, 10);
    const position = Number.isNaN(parsedPosition) ? 0 : parsedPosition;

    db.prepare(
      'UPDATE studio_insights SET stat_value = ?, stat_caption = ?, data_count = ?, position = ? WHERE id = ?'
    ).run(statValue, statCaption, dataCount, position, insightId);

    req.session.flash = { success: 'La statistique a été mise à jour.' };
    return res.redirect('/admin#studio-insights');
  })
);

app.post(
  '/admin/studio-insights/:id/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const insightId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(insightId) || insightId <= 0) {
      req.session.flash = { errors: ['Statistique introuvable.'] };
      return res.redirect('/admin#studio-insights');
    }

    const existing = studioInsightByIdStatement.get(insightId);
    if (!existing) {
      req.session.flash = { errors: ['Cette statistique est introuvable.'] };
      return res.redirect('/admin#studio-insights');
    }

    db.prepare('DELETE FROM studio_insights WHERE id = ?').run(insightId);

    req.session.flash = { success: 'La statistique a été supprimée.' };
    return res.redirect('/admin#studio-insights');
  })
);

app.post(
  '/admin/hero-intro',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      hero_intro_heading: rawHeading = '',
      hero_intro_subheading: rawSubheading = '',
      hero_intro_body: rawBody = '',
      hero_intro_image_url: rawImageUrl = '',
    } = req.body;

    const heading = rawHeading.trim();
    const subheading = rawSubheading.trim();
    const body = rawBody.trim();
    const proposedImageUrl = rawImageUrl.trim();
    const errors = [];

    if (!heading) {
      errors.push("Merci d'indiquer un titre pour la présentation.");
    }

    if (!subheading) {
      errors.push("Merci d'indiquer un sous-titre pour la présentation.");
    }

    if (!body) {
      errors.push("Merci de rédiger un texte de présentation.");
    }

    let heroImageUrl = DEFAULT_HERO_IMAGE_URL;

    const currentSettings = db
      .prepare('SELECT contact_email, hero_intro_image_url FROM settings WHERE id = 1')
      .get();

    const contactEmail = currentSettings?.contact_email || 'contact@cecilartiste.com';
    const existingImage = resolveHeroImageUrl(currentSettings?.hero_intro_image_url);

    if (!proposedImageUrl) {
      heroImageUrl = existingImage;
    } else {
      try {
        const parsed = new URL(proposedImageUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.push("Merci de fournir une URL d'image valide (http ou https).");
        } else {
          heroImageUrl = parsed.toString();
        }
      } catch (error) {
        errors.push("Merci de fournir une URL d'image valide (http ou https).");
      }
    }

    if (errors.length > 0) {
      req.session.flash = { errors };
      return res.redirect('/admin#hero-intro');
    }

    if (currentSettings) {
      db.prepare(
        'UPDATE settings SET hero_intro_heading = ?, hero_intro_subheading = ?, hero_intro_body = ?, hero_intro_image_url = ? WHERE id = 1'
      ).run(heading, subheading, body, heroImageUrl);
    } else {
      db.prepare(
        'INSERT INTO settings (id, contact_email, hero_intro_heading, hero_intro_subheading, hero_intro_body, hero_intro_image_url) VALUES (1, ?, ?, ?, ?, ?)'
      ).run(contactEmail, heading, subheading, body, heroImageUrl);
    }

    req.session.flash = { success: 'Présentation mise à jour.' };
    return res.redirect('/admin#hero-intro');
  })
);

app.post(
  '/admin/contact-email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { contact_email: email = '' } = req.body;
    const trimmed = email.trim();

    const emailRegex = /.+@.+\..+/;
    if (!trimmed || !emailRegex.test(trimmed)) {
      req.session.flash = { errors: ["Veuillez indiquer une adresse email valide."] };
      return res.redirect('/admin');
    }

    const exists = db.prepare('SELECT COUNT(*) AS count FROM settings WHERE id = 1').get();
    if (exists.count > 0) {
      db.prepare('UPDATE settings SET contact_email = ? WHERE id = 1').run(trimmed);
    } else {
      db.prepare('INSERT INTO settings (id, contact_email) VALUES (1, ?)').run(trimmed);
    }

    req.session.flash = { success: 'Adresse email mise à jour.' };
    return res.redirect('/admin');
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    message: "Une erreur inattendue est survenue. Merci de réessayer plus tard.",
  });
});

app.listen(port, () => {
  console.log(`Serveur lancé sur http://localhost:${port}`);
});
