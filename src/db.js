const path = require('path');
const fs = require('fs');
const { slugify } = require('./utils');
let DatabaseConstructor;
let usingBetterSqlite = false;

try {
  DatabaseConstructor = require('better-sqlite3');
  usingBetterSqlite = true;
} catch (error) {
  ({ DatabaseSync: DatabaseConstructor } = require('node:sqlite'));
}

const dbPath = path.join(__dirname, '..', 'data', 'cecilartiste.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseConstructor(dbPath);

function runPragma(statement) {
  if (usingBetterSqlite && typeof db.pragma === 'function') {
    db.pragma(statement);
  } else {
    db.exec(`PRAGMA ${statement}`);
  }
}

runPragma('journal_mode = WAL');
runPragma('busy_timeout = 5000');
runPragma('foreign_keys = ON');

const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    image_path TEXT NOT NULL,
    palette TEXT DEFAULT 'vibrant',
    accent_color TEXT DEFAULT '#ff6f61',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    hero_image_path TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS experiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT,
    image_path TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS studio_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_value TEXT NOT NULL,
    stat_caption TEXT NOT NULL,
    data_count INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    contact_email TEXT NOT NULL,
    hero_intro_heading TEXT DEFAULT 'Qui suis-je ?' NOT NULL,
    hero_intro_subheading TEXT DEFAULT 'Cécile, photographe professionnelle à Amiens' NOT NULL,
    hero_intro_body TEXT DEFAULT 'Artiste photographe spécialisée dans les univers colorés, j’immortalise vos histoires à Amiens et partout où elles me portent. Reportages de mariages, portraits signature ou projets professionnels : je me déplace en France et à l’international pour créer des images lumineuses qui vous ressemblent.' NOT NULL,
    hero_intro_image_url TEXT DEFAULT 'https://i.imgur.com/wy27JGt.jpeg' NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON contact_messages(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_position ON categories(position ASC, name ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_experiences_position ON experiences(position ASC, title ASC)`
];

function prepareDatabase() {
  migrations.forEach(sql => {
    db.exec(sql);
  });

  const photoColumns = db.prepare('PRAGMA table_info(photos)').all();
  const hasCategoryColumn = photoColumns.some(column => column.name === 'category_id');
  if (!hasCategoryColumn) {
    db.exec('ALTER TABLE photos ADD COLUMN category_id INTEGER REFERENCES categories(id)');
  }

  const categoryColumns = db.prepare('PRAGMA table_info(categories)').all();
  const hasSlugColumn = categoryColumns.some(column => column.name === 'slug');
  if (!hasSlugColumn) {
    db.exec('ALTER TABLE categories ADD COLUMN slug TEXT');
  }

  const settingsColumns = db.prepare('PRAGMA table_info(settings)').all();
  const columnNames = settingsColumns.map(column => column.name);

  const heroDefaults = {
    heading: 'Qui suis-je ?',
    subheading: 'Cécile, photographe professionnelle à Amiens',
    body:
      'Artiste photographe spécialisée dans les univers colorés, j’immortalise vos histoires à Amiens et partout où elles me portent. Reportages de mariages, portraits signature ou projets professionnels : je me déplace en France et à l’international pour créer des images lumineuses qui vous ressemblent.',
    image:
      'https://i.imgur.com/wy27JGt.jpeg',
  };

  if (!columnNames.includes('hero_intro_heading')) {
    db.exec(
      "ALTER TABLE settings ADD COLUMN hero_intro_heading TEXT DEFAULT 'Qui suis-je ?' NOT NULL"
    );
  }

  if (!columnNames.includes('hero_intro_subheading')) {
    db.exec(
      "ALTER TABLE settings ADD COLUMN hero_intro_subheading TEXT DEFAULT 'Cécile, photographe professionnelle à Amiens' NOT NULL"
    );
  }

  if (!columnNames.includes('hero_intro_body')) {
    db.exec(
      "ALTER TABLE settings ADD COLUMN hero_intro_body TEXT DEFAULT 'Artiste photographe spécialisée dans les univers colorés, j’immortalise vos histoires à Amiens et partout où elles me portent. Reportages de mariages, portraits signature ou projets professionnels : je me déplace en France et à l’international pour créer des images lumineuses qui vous ressemblent.' NOT NULL"
    );
  }

  if (!columnNames.includes('hero_intro_image_url')) {
    db.exec(
      "ALTER TABLE settings ADD COLUMN hero_intro_image_url TEXT DEFAULT 'https://i.imgur.com/wy27JGt.jpeg' NOT NULL"
    );
  }

  db.prepare(
    'INSERT OR IGNORE INTO settings (id, contact_email, hero_intro_heading, hero_intro_subheading, hero_intro_body, hero_intro_image_url) VALUES (1, ?, ?, ?, ?, ?)'
  ).run(
    'contact@cecilartiste.com',
    heroDefaults.heading.trim(),
    heroDefaults.subheading,
    heroDefaults.body,
    heroDefaults.image
  );

  db.prepare(
    "UPDATE settings SET hero_intro_heading = COALESCE(NULLIF(TRIM(hero_intro_heading), ''), ?), hero_intro_subheading = COALESCE(NULLIF(TRIM(hero_intro_subheading), ''), ?), hero_intro_body = COALESCE(NULLIF(TRIM(hero_intro_body), ''), ?), hero_intro_image_url = COALESCE(NULLIF(TRIM(hero_intro_image_url), ''), ?) WHERE id = 1"
  ).run(heroDefaults.heading.trim(), heroDefaults.subheading, heroDefaults.body, heroDefaults.image);

  const defaultCategories = [
    'Mariage',
    'Baptême',
    'Anniversaire',
    'Grossesse',
    'Nouveau-né',
    'Autres'
  ];

  defaultCategories.forEach((name, index) => {
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (!existing) {
      db.prepare(
        'INSERT INTO categories (name, description, position) VALUES (?, ?, ?)'
      ).run(name, null, index);
    }
  });

  const categories = db
    .prepare('SELECT id, name, slug FROM categories ORDER BY position ASC, name ASC')
    .all();

  const ensureUniqueSlug = (candidate, categoryId) => {
    let base = slugify(candidate);
    if (!base) {
      base = `categorie-${categoryId}`;
    }

    let finalSlug = base;
    let suffix = 1;
    const conflictStatement = db.prepare(
      'SELECT id FROM categories WHERE slug = ? AND id <> ?'
    );

    while (true) {
      const conflict = conflictStatement.get(finalSlug, categoryId);
      if (!conflict) {
        return finalSlug;
      }
      suffix += 1;
      finalSlug = `${base}-${suffix}`;
    }
  };

  const updateSlugStatement = db.prepare(
    'UPDATE categories SET slug = ? WHERE id = ?'
  );

  categories.forEach(category => {
    const currentSlug = (category.slug || '').trim();
    const nextSlug = currentSlug
      ? ensureUniqueSlug(currentSlug, category.id)
      : ensureUniqueSlug(category.name, category.id);
    if (nextSlug !== currentSlug) {
      updateSlugStatement.run(nextSlug, category.id);
    }
  });

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)');

  const experienceColumns = db.prepare('PRAGMA table_info(experiences)').all();
  const experienceColumnNames = experienceColumns.map(column => column.name);

  if (!experienceColumnNames.includes('icon')) {
    db.exec('ALTER TABLE experiences ADD COLUMN icon TEXT');
  }

  if (!experienceColumnNames.includes('image_path')) {
    db.exec('ALTER TABLE experiences ADD COLUMN image_path TEXT');
  }

  if (!experienceColumnNames.includes('position')) {
    db.exec('ALTER TABLE experiences ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  }

  const defaultExperiences = [
    {
      title: 'Reportages vibrants',
      description:
        "Saisir le mouvement, l'énergie et les couleurs intenses de vos événements artistiques.",
      icon: '📸',
    },
    {
      title: 'Portraits poétiques',
      description:
        'Composer des portraits sensibles inspirés par la lumière naturelle et la mise en scène.',
      icon: '🌤️',
    },
    {
      title: 'Univers de marque',
      description:
        "Construire des visuels signature pour révéler l'ADN coloré de votre entreprise.",
      icon: '🍹',
    },
  ];

  const { count: experienceCount } = db
    .prepare('SELECT COUNT(*) AS count FROM experiences')
    .get();

  if (experienceCount === 0) {
    defaultExperiences.forEach((experience, index) => {
      db.prepare(
        'INSERT INTO experiences (title, description, icon, position) VALUES (?, ?, ?, ?)'
      ).run(experience.title, experience.description, experience.icon, index);
    });
  }

  const defaultInsights = [
    {
      stat_value: '12',
      stat_caption: 'années de reportages et de créations sur-mesure',
      data_count: 12,
    },
    {
      stat_value: '180',
      stat_caption: 'clients accompagnés entre Paris, Lyon et Montréal',
      data_count: 180,
    },
    {
      stat_value: '3200',
      stat_caption: 'photographies livrées avec retouches colorimétriques',
      data_count: 3200,
    },
    {
      stat_value: '28',
      stat_caption: 'expositions collectives & installations artistiques',
      data_count: 28,
    },
  ];

  const { count: insightCount } = db
    .prepare('SELECT COUNT(*) AS count FROM studio_insights')
    .get();

  if (insightCount === 0) {
    defaultInsights.forEach((insight, index) => {
      db.prepare(
        'INSERT INTO studio_insights (stat_value, stat_caption, data_count, position) VALUES (?, ?, ?, ?)'
      ).run(insight.stat_value, insight.stat_caption, insight.data_count, index);
    });
  }
}

prepareDatabase();

module.exports = db;
module.exports.DB_PATH = dbPath;
module.exports.prepareDatabase = prepareDatabase;
