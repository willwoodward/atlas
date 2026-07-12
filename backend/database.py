import os
import aiosqlite

DATABASE_PATH = os.getenv("DATABASE_PATH", "./atlas.db")


async def get_db():
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def init_db():
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS habits (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS habit_completions (
                habit_id TEXT NOT NULL,
                date TEXT NOT NULL,
                PRIMARY KEY (habit_id, date),
                FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                bucket TEXT NOT NULL DEFAULT 'today',
                goal_id TEXT,
                done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS week_outcomes (
                week_str TEXT PRIMARY KEY,
                text TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                color TEXT NOT NULL,
                created_at TEXT NOT NULL,
                q1 TEXT NOT NULL DEFAULT '',
                q2 TEXT NOT NULL DEFAULT '',
                q3 TEXT NOT NULL DEFAULT '',
                q4 TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS finances_pots (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                target_amount REAL NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS finances_sub_goals (
                id TEXT PRIMARY KEY,
                pot_id TEXT NOT NULL,
                name TEXT NOT NULL,
                target_amount REAL NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (pot_id) REFERENCES finances_pots(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS finances_deposits (
                id TEXT PRIMARY KEY,
                pot_id TEXT NOT NULL,
                amount REAL NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL,
                FOREIGN KEY (pot_id) REFERENCES finances_pots(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS finances_transactions (
                id TEXT PRIMARY KEY,
                merchant TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL,
                date TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'expense'
            );

            CREATE TABLE IF NOT EXISTS finances_accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                institution TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL DEFAULT 'checking',
                balance REAL NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                body TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_events (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                date TEXT NOT NULL,
                start_h REAL NOT NULL DEFAULT 9,
                end_h REAL NOT NULL DEFAULT 10,
                color TEXT NOT NULL DEFAULT '#5f7591',
                notes TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS user_profile (
                id INTEGER PRIMARY KEY DEFAULT 1,
                name TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT ''
            );

            INSERT OR IGNORE INTO user_profile (id, name, email) VALUES (1, '', '');

            CREATE TABLE IF NOT EXISTS user_integrations (
                email TEXT PRIMARY KEY,
                gcal_token TEXT,
                gcal_expires_at INTEGER,
                gcal_refresh_token TEXT,
                gcal_access_token TEXT,
                gcal_access_expires_at INTEGER,
                github_token TEXT,
                github_repo TEXT
            );

            CREATE TABLE IF NOT EXISTS github_drafts (
                path TEXT PRIMARY KEY,
                content TEXT NOT NULL DEFAULT '',
                saved_at TEXT NOT NULL
            );
        """)
        await db.commit()

        # Migrations — add columns that may not exist in older DBs
        for stmt in [
            "ALTER TABLE todos ADD COLUMN parent_id TEXT",
            "ALTER TABLE todos ADD COLUMN completed_at TEXT",
            "ALTER TABLE user_integrations ADD COLUMN gcal_refresh_token TEXT",
            "ALTER TABLE user_integrations ADD COLUMN gcal_access_token TEXT",
            "ALTER TABLE user_integrations ADD COLUMN gcal_access_expires_at INTEGER",
        ]:
            try:
                await db.execute(stmt)
                await db.commit()
            except Exception:
                pass  # column already exists
