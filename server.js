const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const db = require('./src/db');
const { verifyPassword } = require('./src/passwords');
const {
  ensureUploadDir,
  formatDate,
  nl2br,
  deleteFileIfExists,
  normalizePublicPath,
} = require('./src/utils');

const app = express();
const port = process.env.PORT || 3000;

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
    res.render('index', {
      photos,
      categories,
    });
  })
);

app.get(
  '/contact',
  asyncHandler(async (req, res) => {
    const settings = db.prepare('SELECT contact_email FROM settings WHERE id = 1').get();
    const contactEmail = settings ? settings.contact_email : 'contact@cecilartiste.com';
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
    const formData = { name, email, subject, message };

    if (!name.trim() || !email.trim() || !message.trim()) {
      req.session.flash = {
        error: 'Merci de renseigner votre nom, email et message.',
        formData,
      };
      return res.redirect('/contact');
    }

    const emailRegex = /.+@.+\..+/;
    if (!emailRegex.test(email)) {
      req.session.flash = {
        error: "L'adresse email fournie n'est pas valide.",
        formData,
      };
      return res.redirect('/contact');
    }

    db.prepare(
      'INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)'
    ).run(name.trim(), email.trim(), subject.trim(), message.trim());

    req.session.flash = {
      success: 'Merci ! Votre message a bien été enregistré. Je vous réponds rapidement.',
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
    const settings = db.prepare('SELECT contact_email FROM settings WHERE id = 1').get();
    const contactEmail = settings ? settings.contact_email : 'contact@cecilartiste.com';
    const messages = db
      .prepare(
        'SELECT id, name, email, subject, message, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 20'
      )
      .all();
    const { success = null, errors = [] } = res.locals.flash;

    return res.render('admin/dashboard', {
      photos,
      categories,
      contactEmail,
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
  photoUpload('photo'),
  asyncHandler(async (req, res) => {
    const {
      title = '',
      description = '',
      palette = 'vibrant',
      accent_color = '#ff6f61',
      category_id: rawCategoryId = '',
    } = req.body;
    const errors = [];

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

    if (!req.file) {
      errors.push('Merci de sélectionner une image à téléverser.');
    }

    if (errors.length > 0) {
      if (req.file) {
        deleteFileIfExists(`/uploads/${req.file.filename}`);
      }
      req.session.flash = { errors };
      return res.redirect('/admin');
    }

    const relativePath = `/uploads/${req.file.filename}`;

    db.prepare(
      'INSERT INTO photos (title, description, image_path, palette, accent_color, category_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      title.trim(),
      description.trim(),
      relativePath,
      palette.trim(),
      accent_color.trim() || '#ff6f61',
      categoryValue
    );

    req.session.flash = { success: 'La photo a été ajoutée avec succès.' };
    return res.redirect('/admin');
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
      palette = 'vibrant',
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
      db.prepare(
        'UPDATE photos SET title = ?, description = ?, palette = ?, accent_color = ?, category_id = ?, image_path = ? WHERE id = ?'
      ).run(
        title.trim(),
        description.trim(),
        palette.trim(),
        accent_color.trim() || '#ff6f61',
        categoryValue,
        newPath,
        photoId
      );
      deleteFileIfExists(existing.image_path);
    } else {
      db.prepare(
        'UPDATE photos SET title = ?, description = ?, palette = ?, accent_color = ?, category_id = ? WHERE id = ?'
      ).run(
        title.trim(),
        description.trim(),
        palette.trim(),
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
    const { name = '', description = '', position = '' } = req.body;
    const trimmedName = name.trim();
    const descriptionValue = description.trim();
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

    db.prepare(
      'INSERT INTO categories (name, description, hero_image_path, position) VALUES (?, ?, ?, ?)'
    ).run(trimmedName, descriptionValue, heroImagePath, finalPosition);

    req.session.flash = { success: 'Catégorie créée avec succès.' };
    return res.redirect('/admin#categories');
  })
);

app.post(
  '/admin/categories/:id',
  requireAuth,
  uploadAndHandle('hero_image', async (req, res) => {
    const categoryId = Number.parseInt(req.params.id, 10);
    const { name = '', description = '', position = '' } = req.body;
    const trimmedName = name.trim();
    const descriptionValue = description.trim();
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

    db.prepare(
      'UPDATE categories SET name = ?, description = ?, hero_image_path = ?, position = ? WHERE id = ?'
    ).run(trimmedName, descriptionValue, heroImagePath, finalPosition, categoryId);

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
