const path = require('path');
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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
  limits: {
    fileSize: 8 * 1024 * 1024,
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
      title = '',
      description = '',
      accent_color = '#ff6f61',
      category_id: rawCategoryId = '',
    } = req.body;
    const errors = [];
    const files = Array.isArray(req.files) ? req.files : [];

    if (!title.trim()) {
      errors.push('Le titre est requis pour ajouter une photo.');
    }

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

    const sanitizedTitle = title.trim();
    const sanitizedDescription = description.trim();
    const sanitizedAccent = accent_color.trim() || '#ff6f61';
    const insertStatement = db.prepare(
      'INSERT INTO photos (title, description, image_path, accent_color, category_id) VALUES (?, ?, ?, ?, ?)'
    );

    files.forEach((file, index) => {
      const relativePath = `/uploads/${file.filename}`;
      const photoTitle =
        files.length === 1 || index === 0
          ? sanitizedTitle
          : `${sanitizedTitle} (${index + 1})`;
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
      title = '',
      description = '',
      accent_color = '#ff6f61',
      category_id: rawCategoryId = '',
    } = req.body;
    const errors = [];

    if (!Number.isInteger(photoId) || photoId <= 0) {
      errors.push('Photo introuvable.');
    }

    if (!title.trim()) {
      errors.push('Merci de renseigner un titre.');
    }

    const existing = db.prepare('SELECT image_path FROM photos WHERE id = ?').get(photoId);
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

    if (req.file) {
      const newPath = `/uploads/${req.file.filename}`;
      db
        .prepare('UPDATE photos SET title = ?, description = ?, accent_color = ?, category_id = ?, image_path = ? WHERE id = ?')
        .run(
          title.trim(),
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
          title.trim(),
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
