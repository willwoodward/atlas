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

            -- One free-form review per calendar quarter, keyed 'YYYY-Qn'. Goals
            -- themselves are not year-scoped, so the year lives here instead.
            CREATE TABLE IF NOT EXISTS goal_reflections (
                period TEXT PRIMARY KEY,
                text TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
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

            -- Description pattern -> category, applied at import time.
            -- Ordered: the first match wins, so sort_order is meaningful.
            CREATE TABLE IF NOT EXISTS finances_import_rules (
                id TEXT PRIMARY KEY,
                pattern TEXT NOT NULL,
                category TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            -- One budget per category per period. Kept simple on purpose: a
            -- budget people actually maintain beats an accurate one they abandon.
            CREATE TABLE IF NOT EXISTS finances_budgets (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL UNIQUE,
                amount REAL NOT NULL DEFAULT 0,
                period TEXT NOT NULL DEFAULT 'monthly'
            );

            -- Employment and compensation.
            --
            -- Kept separate from finances_transactions on purpose: transactions
            -- are what *did* land in an account, this is what is *contracted to*
            -- land. Mixing them would double-count every payday. Amounts here
            -- are gross unless is_gross is 0.
            CREATE TABLE IF NOT EXISTS finances_employment (
                id TEXT PRIMARY KEY,
                employer TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT 'EUR',
                start_date TEXT NOT NULL DEFAULT '',
                effective_tax_rate REAL NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT ''
            );

            -- kind: base | oncall | bonus | other
            -- cadence: monthly | annual | one_off
            CREATE TABLE IF NOT EXISTS finances_comp_components (
                id TEXT PRIMARY KEY,
                employment_id TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'base',
                label TEXT NOT NULL,
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'EUR',
                cadence TEXT NOT NULL DEFAULT 'annual',
                start_date TEXT NOT NULL DEFAULT '',
                end_date TEXT NOT NULL DEFAULT '',
                is_gross INTEGER NOT NULL DEFAULT 1,
                notes TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (employment_id) REFERENCES finances_employment(id) ON DELETE CASCADE
            );

            -- Equity is held in units, never in a cash amount: the value of a
            -- grant is only knowable at vest, and storing a guess as if it were
            -- money is how a dashboard starts lying to you.
            CREATE TABLE IF NOT EXISTS finances_rsu_grants (
                id TEXT PRIMARY KEY,
                employment_id TEXT NOT NULL,
                label TEXT NOT NULL,
                grant_date TEXT NOT NULL DEFAULT '',
                total_units REAL NOT NULL DEFAULT 0,
                symbol TEXT NOT NULL DEFAULT 'AMZN',
                currency TEXT NOT NULL DEFAULT 'USD',
                notes TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (employment_id) REFERENCES finances_employment(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS finances_vesting_events (
                id TEXT PRIMARY KEY,
                grant_id TEXT NOT NULL,
                vest_date TEXT NOT NULL,
                units REAL NOT NULL DEFAULT 0,
                FOREIGN KEY (grant_id) REFERENCES finances_rsu_grants(id) ON DELETE CASCADE
            );

            -- Manually maintained. No market data call is made: a dashboard that
            -- reaches out to a price API on every render is a data-leak surface
            -- and an availability dependency, for a number that only needs to be
            -- roughly right.
            CREATE TABLE IF NOT EXISTS finances_market_prices (
                symbol TEXT PRIMARY KEY,
                price REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                as_of TEXT NOT NULL DEFAULT ''
            );

            -- Signed-out sessions (by token id) and a "sessions valid after"
            -- cut-off for signing out everywhere. See auth.py.
            CREATE TABLE IF NOT EXISTS revoked_tokens (
                jti TEXT PRIMARY KEY,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- ECB daily reference rates, "1 EUR = rate CUR" (see fx.py).
            CREATE TABLE IF NOT EXISTS fx_daily (
                date TEXT NOT NULL,
                currency TEXT NOT NULL,
                rate REAL NOT NULL,
                PRIMARY KEY (date, currency)
            );

            CREATE TABLE IF NOT EXISTS finances_fx_rates (
                currency TEXT PRIMARY KEY,
                rate_to_gbp REAL NOT NULL DEFAULT 1,
                as_of TEXT NOT NULL DEFAULT ''
            );

            -- ── Fitness ──────────────────────────────────────────────────────
            --
            -- Gym data is yours and lives here permanently. Strava data does
            -- NOT: Strava's API policy forbids retaining it beyond seven days
            -- outside a transient cache, so activities are fetched live and
            -- held in memory only (see strava_client.py). The one Strava row
            -- stored is the connection itself — credentials, encrypted.
            CREATE TABLE IF NOT EXISTS gym_sections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#c15f3c',
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS gym_exercises (
                id TEXT PRIMARY KEY,
                section_id TEXT NOT NULL,
                name TEXT NOT NULL,
                weight REAL,
                unit TEXT NOT NULL DEFAULT 'kg',
                sets INTEGER,
                reps TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (section_id) REFERENCES gym_sections(id) ON DELETE CASCADE
            );

            -- One row per change of working weight, so progression survives
            -- the exercise row being edited in place.
            CREATE TABLE IF NOT EXISTS gym_lift_log (
                id TEXT PRIMARY KEY,
                exercise_id TEXT NOT NULL,
                date TEXT NOT NULL,
                weight REAL,
                sets INTEGER,
                reps TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (exercise_id) REFERENCES gym_exercises(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS strava_connection (
                id INTEGER PRIMARY KEY DEFAULT 1,
                athlete_id INTEGER NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                scope TEXT NOT NULL DEFAULT '',
                connected_at TEXT NOT NULL
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

            -- Assistant runs. A run outlives the HTTP request that started it, so
            -- long tool-using work survives the browser closing or a device switch.
            CREATE TABLE IF NOT EXISTS agent_runs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',  -- running|done|error|cancelled
                prompt TEXT NOT NULL DEFAULT '',
                error TEXT
            );

            CREATE TABLE IF NOT EXISTS agent_run_events (
                run_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                type TEXT NOT NULL,
                payload TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (run_id, seq)
            );

            CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at DESC);

            -- A conversation with the assistant: a run of turns, shared by every
            -- device. One goes stale after a quiet spell and the next message
            -- starts a fresh one, but none are deleted — they are the session log.
            CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                closed INTEGER NOT NULL DEFAULT 0
            );

            -- The assistant's memory: context it reads at the start of every run
            -- and may rewrite. Every save is a new version, so any edit — the
            -- user's or the assistant's — can be undone.
            CREATE TABLE IF NOT EXISTS assistant_memory (
                version INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'user'  -- user|assistant|restore
            );
            -- (kind column added by migration below: memory|prompt)

            -- Every change the assistant makes, with how to undo it
            -- (see agent_actions.py).
            CREATE TABLE IF NOT EXISTS agent_actions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                tool TEXT NOT NULL,
                summary TEXT NOT NULL,
                undo TEXT,            -- JSON recipe, NULL if it can't be undone
                show TEXT,            -- JSON: what to open to see the change
                undone_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_agent_actions_created ON agent_actions(created_at DESC);
        """)
        await db.commit()

        # Migrations — add columns that may not exist in older DBs
        for stmt in [
            "ALTER TABLE agent_runs ADD COLUMN session_id TEXT",
            "ALTER TABLE agent_runs ADD COLUMN user_message TEXT",
            "ALTER TABLE agent_runs ADD COLUMN reply TEXT",
            # assistant_memory holds the system prompt's versions too.
            "ALTER TABLE assistant_memory ADD COLUMN kind TEXT NOT NULL DEFAULT 'memory'",
            # The memory and prompt versions a session started with. It keeps
            # them for every turn; edits apply from the next session.
            "ALTER TABLE agent_sessions ADD COLUMN memory_version INTEGER",
            "ALTER TABLE agent_sessions ADD COLUMN prompt_version INTEGER",
            "ALTER TABLE todos ADD COLUMN parent_id TEXT",
            "ALTER TABLE todos ADD COLUMN completed_at TEXT",
            "ALTER TABLE user_integrations ADD COLUMN gcal_refresh_token TEXT",
            "ALTER TABLE user_integrations ADD COLUMN gcal_access_token TEXT",
            "ALTER TABLE user_integrations ADD COLUMN gcal_access_expires_at INTEGER",
            # Finances: link transactions to an account, and make imports
            # idempotent. external_id is the bank's own ID where one exists and
            # a content hash where it does not.
            "ALTER TABLE finances_transactions ADD COLUMN account_id TEXT",
            "ALTER TABLE finances_transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP'",
            "ALTER TABLE finances_transactions ADD COLUMN fx_rate REAL NOT NULL DEFAULT 1",
            "ALTER TABLE finances_transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
            "ALTER TABLE finances_transactions ADD COLUMN external_id TEXT",
            "ALTER TABLE finances_accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP'",
            # Comma-separated keywords; calendar events whose title contains
            # one count as time spent on that goal.
            "ALTER TABLE goals ADD COLUMN tags TEXT NOT NULL DEFAULT ''",
            # Multi-currency: transactions are stored in their account's
            # currency; a row converted at import keeps what the bank showed.
            # Pots and budgets created before this were shown in £, hence the
            # GBP default for existing rows (new ones are sent explicitly).
            "ALTER TABLE finances_transactions ADD COLUMN orig_amount REAL",
            "ALTER TABLE finances_transactions ADD COLUMN orig_currency TEXT",
            "ALTER TABLE finances_pots ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP'",
            "ALTER TABLE finances_budgets ADD COLUMN currency TEXT NOT NULL DEFAULT 'GBP'",
            # Date the balance is correct as of: set from a statement's closing
            # balance or a manual edit, so an older statement can't overwrite it.
            "ALTER TABLE finances_accounts ADD COLUMN balance_as_of TEXT",
            # Who set the category: 'rule' (an import rule), 'ai' (auto-
            # categorised, a guess) or 'manual' (you). Rules and edits replace
            # AI guesses; nothing replaces a manual choice.
            "ALTER TABLE finances_transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT ''",
            # A budget can cover several categories (JSON list); the `category`
            # column is its name. Empty means just the category it's named after.
            "ALTER TABLE finances_budgets ADD COLUMN categories TEXT NOT NULL DEFAULT ''",
        ]:
            try:
                await db.execute(stmt)
                await db.commit()
            except Exception:
                pass  # column already exists

        # Partial index: manual rows have no external_id and must stay free to
        # collide, while imported rows are unique on it. This is what makes
        # re-importing an overlapping date range a no-op.
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_external_id "
            "ON finances_transactions(external_id) WHERE external_id IS NOT NULL"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_txn_date ON finances_transactions(date DESC)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, created_at)"
        )
        await db.commit()

        # If a key has just been configured, bring rows written before it up to
        # date. Safe to run on every boot: already-encrypted values are skipped.
        db.row_factory = aiosqlite.Row
        from crypto import encrypt_existing_secrets
        await encrypt_existing_secrets(db)
