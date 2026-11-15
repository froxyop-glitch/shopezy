const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL_ENGINE = null;
let singletonInstance = null;

class SqlJsStatement {
    constructor(db, sql, wrapper) {
        this.db = db;
        this.sql = sql;
        this.wrapper = wrapper;
    }

    _normalizeParams(args) {
        if (args.length === 0) return [];
        if (args.length === 1) {
            if (Array.isArray(args[0])) {
                return args[0].map(a => a === undefined ? null : a);
            }
            if (typeof args[0] === 'object' && args[0] !== null) {
                const obj = {};
                for (const [k, v] of Object.entries(args[0])) {
                    const cleanVal = v === undefined ? null : v;
                    obj[k] = cleanVal;
                    if (!k.startsWith('@') && !k.startsWith(':') && !k.startsWith('$')) {
                        obj['@' + k] = cleanVal;
                        obj[':' + k] = cleanVal;
                        obj['$' + k] = cleanVal;
                    }
                }
                return obj;
            }
        }
        return args.map(a => a === undefined ? null : a);
    }

    get(...args) {
        const params = this._normalizeParams(args);
        const stmt = this.db.prepare(this.sql);
        try {
            stmt.bind(params);
            if (stmt.step()) {
                return stmt.getAsObject();
            }
            return undefined;
        } catch (err) {
            console.error('SQL Error in get:', this.sql, err.message);
            throw err;
        } finally {
            stmt.free();
        }
    }

    all(...args) {
        const params = this._normalizeParams(args);
        const stmt = this.db.prepare(this.sql);
        try {
            stmt.bind(params);
            const results = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            return results;
        } catch (err) {
            console.error('SQL Error in all:', this.sql, err.message);
            throw err;
        } finally {
            stmt.free();
        }
    }

    run(...args) {
        const params = this._normalizeParams(args);
        const stmt = this.db.prepare(this.sql);
        try {
            if (params && !Array.isArray(params) && typeof params === 'object') {
                stmt.bind(params);
                stmt.step();
            } else {
                stmt.run(params);
            }
            const res = this.db.exec('SELECT last_insert_rowid() AS id, changes() AS ch');
            const lastInsertRowid = res[0] && res[0].values[0] ? res[0].values[0][0] : 0;
            const changes = res[0] && res[0].values[0] ? res[0].values[0][1] : 0;
            this.wrapper.save();
            return { lastInsertRowid, changes };
        } catch (err) {
            console.error('SQL Error in run:', this.sql, err.message);
            throw err;
        } finally {
            stmt.free();
        }
    }
}

class SqlJsDatabase {
    constructor(dbPath) {
        this.dbPath = path.resolve(dbPath || './database.sqlite');
        if (!SQL_ENGINE) {
            throw new Error('SQL engine not initialized. Call initSqlEngine() first.');
        }
        if (fs.existsSync(this.dbPath)) {
            const fileBuffer = fs.readFileSync(this.dbPath);
            this.rawDb = new SQL_ENGINE.Database(fileBuffer);
        } else {
            this.rawDb = new SQL_ENGINE.Database();
        }
    }

    save() {
        if (this.dbPath && this.dbPath !== ':memory:') {
            try {
                const data = this.rawDb.export();
                fs.writeFileSync(this.dbPath, Buffer.from(data));
            } catch (e) {
                console.error('Error saving SQLite file:', e.message);
            }
        }
    }

    prepare(sql) {
        return new SqlJsStatement(this.rawDb, sql, this);
    }

    exec(sql) {
        const res = this.rawDb.exec(sql);
        this.save();
        return res;
    }

    pragma(str) {
        try {
            this.rawDb.exec(`PRAGMA ${str};`);
        } catch (e) {}
        return this;
    }

    transaction(fn) {
        return (...args) => {
            this.rawDb.exec('BEGIN TRANSACTION;');
            try {
                const res = fn(...args);
                this.rawDb.exec('COMMIT;');
                this.save();
                return res;
            } catch (err) {
                try { this.rawDb.exec('ROLLBACK;'); } catch (e) {}
                throw err;
            }
        };
    }

    close() {
        this.save();
    }
}

async function initSqlEngine() {
    if (!SQL_ENGINE) {
        SQL_ENGINE = await initSqlJs();
    }
    return SQL_ENGINE;
}

function getDatabase(dbPath) {
    if (!singletonInstance) {
        singletonInstance = new SqlJsDatabase(dbPath);
    }
    return singletonInstance;
}

module.exports = {
    initSqlEngine,
    SqlJsDatabase,
    getDatabase
};
