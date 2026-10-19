const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const file = process.env.PIPPO_DB || path.join(__dirname, 'data', 'pippo.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass        TEXT NOT NULL,
    daily_goal  INTEGER NOT NULL DEFAULT 20,
    xp          INTEGER NOT NULL DEFAULT 0,
    streak      INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    last_day    TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token   TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decks (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    lang_from  TEXT NOT NULL DEFAULT 'en',
    lang_to    TEXT NOT NULL DEFAULT 'uk',
    created_at INTEGER NOT NULL
  );

  -- box: поличка Лейтнера 0..5, due: коли слово знову треба повторити (ms)
  CREATE TABLE IF NOT EXISTS words (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_id     INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    term        TEXT NOT NULL,
    translation TEXT NOT NULL,
    example     TEXT NOT NULL DEFAULT '',
    box         INTEGER NOT NULL DEFAULT 0,
    due         INTEGER NOT NULL DEFAULT 0,
    hits        INTEGER NOT NULL DEFAULT 0,
    misses      INTEGER NOT NULL DEFAULT 0,
    starred     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS words_deck ON words(deck_id);
  CREATE INDEX IF NOT EXISTS words_user_due ON words(user_id, due);

  CREATE TABLE IF NOT EXISTS activity (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,
    answers INTEGER NOT NULL DEFAULT 0,
    correct INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  CREATE TABLE IF NOT EXISTS tests (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode       TEXT NOT NULL,
    total      INTEGER NOT NULL,
    correct    INTEGER NOT NULL,
    xp         INTEGER NOT NULL DEFAULT 0,
    duration   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

// Прості міграції для вже створених баз
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('words', 'transcription', "TEXT NOT NULL DEFAULT ''");
addColumn('words', 'xp_day', 'TEXT');
addColumn('words', 'xp_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('words', 'missed_day', 'TEXT');
addColumn('users', 'grains', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'timezone', "TEXT NOT NULL DEFAULT 'Europe/Kyiv'");
addColumn('users', 'tz_changed_at', 'INTEGER NOT NULL DEFAULT 0');
addColumn('decks', 'pack_id', 'TEXT');
addColumn('activity', 'new_words', 'INTEGER NOT NULL DEFAULT 0');
addColumn('tests', 'day', 'TEXT');
addColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  -- Журнал зерняток: кожне нарахування (+) і витрата (−). once_key — для разових нагород.
  CREATE TABLE IF NOT EXISTS grains (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    day        TEXT NOT NULL,
    once_key   TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS grains_user_day ON grains(user_id, day, kind);
  CREATE UNIQUE INDEX IF NOT EXISTS grains_once ON grains(user_id, once_key) WHERE once_key IS NOT NULL;

  -- Сесія тренування: сервер знає, які слова видав, і приймає відповідь на кожне лише раз
  CREATE TABLE IF NOT EXISTS quiz_sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS quiz_items (
    session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
    word_id    INTEGER NOT NULL,
    answered   INTEGER NOT NULL DEFAULT 0,
    correct    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, word_id)
  );

  -- Звернення до ШІ: для лімітів на акаунт і для аналітики в адмінці
  CREATE TABLE IF NOT EXISTS ai_usage (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    words      INTEGER NOT NULL DEFAULT 1,
    ok         INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ai_usage_user_time ON ai_usage(user_id, created_at);

  CREATE TABLE IF NOT EXISTS user_packs (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id   TEXT NOT NULL,
    deck_id   INTEGER,
    price     INTEGER NOT NULL,
    bought_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, pack_id)
  );
`);

// Старі сесії тренувань більше не потрібні
db.prepare('DELETE FROM quiz_sessions WHERE created_at < ?').run(Date.now() - 2 * 86400000);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx };
