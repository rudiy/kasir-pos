const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const dbPath = path.join(__dirname, '../database/kasir.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
module.exports = db;