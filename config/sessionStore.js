const session = require('express-session');
const db = require('./database');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)');

const stmt = {
  read: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
  write: db.prepare(`INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`),
  remove: db.prepare('DELETE FROM sessions WHERE sid = ?'),
  prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
};

class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
    this.prune();
    const timer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  prune() {
    try {
      stmt.prune.run(Date.now());
    } catch (err) {
      this.emit('error', err);
    }
  }

  get(sid, callback) {
    try {
      const row = stmt.read.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        stmt.remove.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (err) {
      stmt.remove.run(sid);
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = Number(sess && sess.cookie && sess.cookie.maxAge);
      const ttl = Number.isFinite(maxAge) && maxAge > 0 ? maxAge : this.ttlMs;
      stmt.write.run(sid, JSON.stringify(sess), Date.now() + ttl);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      stmt.remove.run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      const maxAge = Number(sess && sess.cookie && sess.cookie.maxAge);
      const ttl = Number.isFinite(maxAge) && maxAge > 0 ? maxAge : this.ttlMs;
      db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() + ttl, sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }
}

module.exports = SqliteSessionStore;
module.exports.DEFAULT_TTL_MS = DEFAULT_TTL_MS;
