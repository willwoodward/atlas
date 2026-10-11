import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from database import get_db
import finance_import
import finance_insights
import fx

router = APIRouter(prefix="/api/finances", tags=["finances"])


# ── Pots ─────────────────────────────────────────────────────────────────────

class PotIn(BaseModel):
    id: str
    name: str
    color: str
    target_amount: float = 0
    notes: str = ""
    currency: str = "EUR"


class SubGoalIn(BaseModel):
    id: str
    name: str
    target_amount: float = 0
    notes: str = ""


class DepositIn(BaseModel):
    id: str
    amount: float
    note: str = ""
    date: str


# ── Transactions ──────────────────────────────────────────────────────────────

class TransactionIn(BaseModel):
    id: str
    merchant: str
    category: str = ""
    amount: float
    date: str
    type: str = "expense"
    account_id: Optional[str] = None
    currency: str = "EUR"
    fx_rate: float = 1.0
    source: str = "manual"
    external_id: Optional[str] = None


class RuleIn(BaseModel):
    id: str
    pattern: str
    category: str


class ImportPreviewIn(BaseModel):
    source: str
    account_id: str
    content: str


class ImportRowIn(BaseModel):
    """A row as /import/preview returned it. No `id` — commit assigns one."""
    external_id: str
    date: str
    merchant: str
    amount: float
    currency: str = "GBP"
    type: str = "expense"
    category: str = ""


class ImportCommitIn(BaseModel):
    source: str
    account_id: str
    rows: list[ImportRowIn]
    fx_rates: dict[str, float] = {}  # ignored: rates now come from the ECB (fx.py)


# ── Accounts ──────────────────────────────────────────────────────────────────

class AccountIn(BaseModel):
    id: str
    name: str
    institution: str = ""
    type: str = "checking"
    balance: float = 0
    currency: str = "EUR"


class AccountUpdate(BaseModel):
    balance: Optional[float] = None
    name: Optional[str] = None
    currency: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def get_finances(user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT * FROM finances_pots ORDER BY sort_order") as cur:
        pots = [dict(r) for r in await cur.fetchall()]

    for pot in pots:
        async with db.execute(
            "SELECT * FROM finances_sub_goals WHERE pot_id = ?", (pot["id"],)
        ) as cur:
            pot["subGoals"] = [dict(r) for r in await cur.fetchall()]
        async with db.execute(
            "SELECT * FROM finances_deposits WHERE pot_id = ? ORDER BY date DESC", (pot["id"],)
        ) as cur:
            pot["deposits"] = [dict(r) for r in await cur.fetchall()]

    async with db.execute("SELECT * FROM finances_transactions ORDER BY date DESC") as cur:
        transactions = [dict(r) for r in await cur.fetchall()]

    async with db.execute("SELECT * FROM finances_accounts") as cur:
        accounts = [dict(r) for r in await cur.fetchall()]

    async with db.execute("SELECT * FROM finances_import_rules ORDER BY sort_order") as cur:
        rules = [dict(r) for r in await cur.fetchall()]

    return {"pots": pots, "transactions": transactions, "accounts": accounts, "rules": rules}


# Pots
@router.post("/pots")
async def add_pot(body: PotIn, user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM finances_pots") as cur:
        order = (await cur.fetchone())[0]
    await db.execute(
        "INSERT INTO finances_pots (id, name, color, target_amount, notes, sort_order, currency) VALUES (?,?,?,?,?,?,?)",
        (body.id, body.name, body.color, body.target_amount, body.notes, order, body.currency.upper()),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/pots/{pot_id}")
async def remove_pot(pot_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_pots WHERE id = ?", (pot_id,))
    await db.execute("DELETE FROM finances_sub_goals WHERE pot_id = ?", (pot_id,))
    await db.execute("DELETE FROM finances_deposits WHERE pot_id = ?", (pot_id,))
    await db.commit()
    return {"ok": True}


# Sub-goals
@router.post("/pots/{pot_id}/subgoals")
async def add_subgoal(pot_id: str, body: SubGoalIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_sub_goals (id, pot_id, name, target_amount, notes) VALUES (?,?,?,?,?)",
        (body.id, pot_id, body.name, body.target_amount, body.notes),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/pots/{pot_id}/subgoals/{sg_id}")
async def remove_subgoal(pot_id: str, sg_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_sub_goals WHERE id = ? AND pot_id = ?", (sg_id, pot_id))
    await db.commit()
    return {"ok": True}


# Deposits
@router.post("/pots/{pot_id}/deposits")
async def add_deposit(pot_id: str, body: DepositIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_deposits (id, pot_id, amount, note, date) VALUES (?,?,?,?,?)",
        (body.id, pot_id, body.amount, body.note, body.date),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/pots/{pot_id}/deposits/{dep_id}")
async def remove_deposit(pot_id: str, dep_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_deposits WHERE id = ? AND pot_id = ?", (dep_id, pot_id))
    await db.commit()
    return {"ok": True}


# Transactions
@router.post("/transactions")
async def add_transaction(body: TransactionIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_transactions "
        "(id, merchant, category, amount, date, type, account_id, currency, fx_rate, source, external_id) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (body.id, body.merchant, body.category, body.amount, body.date, body.type,
         body.account_id, body.currency.upper(), body.fx_rate, body.source, body.external_id),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/transactions/{txn_id}")
async def remove_transaction(txn_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_transactions WHERE id = ?", (txn_id,))
    await db.commit()
    return {"ok": True}


# Accounts
@router.post("/accounts")
async def add_account(body: AccountIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_accounts (id, name, institution, type, balance, currency) VALUES (?,?,?,?,?,?)",
        (body.id, body.name, body.institution, body.type, body.balance, body.currency.upper()),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/accounts/{acc_id}")
async def update_account(acc_id: str, body: AccountUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    if body.balance is not None:
        await db.execute("UPDATE finances_accounts SET balance = ? WHERE id = ?", (body.balance, acc_id))
    if body.name is not None:
        await db.execute("UPDATE finances_accounts SET name = ? WHERE id = ?", (body.name, acc_id))
    if body.currency is not None:
        await db.execute("UPDATE finances_accounts SET currency = ? WHERE id = ?", (body.currency.upper(), acc_id))
    await db.commit()
    return {"ok": True}


@router.delete("/accounts/{acc_id}")
async def remove_account(acc_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_accounts WHERE id = ?", (acc_id,))
    await db.commit()
    return {"ok": True}


# ── Import rules ──────────────────────────────────────────────────────────────

@router.post("/rules")
async def add_rule(body: RuleIn, user=Depends(get_current_user), db=Depends(get_db)):
    async with db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM finances_import_rules") as cur:
        order = (await cur.fetchone())[0]
    await db.execute(
        "INSERT INTO finances_import_rules (id, pattern, category, sort_order) VALUES (?,?,?,?)",
        (body.id, body.pattern, body.category, order),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/rules/{rule_id}")
async def remove_rule(rule_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_import_rules WHERE id = ?", (rule_id,))
    await db.commit()
    return {"ok": True}


# ── Statement import ──────────────────────────────────────────────────────────

@router.get("/import/sources")
async def import_sources(user=Depends(get_current_user)):
    return [{"id": k, "label": v[0]} for k, v in finance_import.PROFILES.items()]


async def _account_currency(db, account_id: str) -> str:
    async with db.execute("SELECT currency FROM finances_accounts WHERE id = ?", (account_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(400, "Choose an account to import into")
    return (row["currency"] or "EUR").upper()


async def _ensure_import_rates(db, rows, account_currency: str) -> "fx.FxTable":
    """Rates for every foreign currency in the file, back to its oldest row.
    A currency the ECB doesn't publish is a 400 — never a silent 1:1."""
    foreign = {r.currency.upper() for r in rows if r.currency.upper() != account_currency}
    if not foreign:
        return fx.FxTable()
    oldest = min(r.date for r in rows)
    table = await fx.ensure(db, foreign | {account_currency}, since=oldest)
    missing = sorted(c for c in foreign | {account_currency} if not table.has(c))
    if missing:
        raise HTTPException(400, f"No exchange rate available for {', '.join(missing)} — couldn't convert into {account_currency}")
    return table


@router.post("/import/preview")
async def import_preview(body: ImportPreviewIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Parse and classify without writing anything.

    Nothing reaches the database until the user has seen this and confirmed —
    an import is the one place where a bad mapping could quietly corrupt a
    year of history, so it is deliberately two-step.
    """
    async with db.execute("SELECT * FROM finances_import_rules ORDER BY sort_order") as cur:
        rules = [dict(r) for r in await cur.fetchall()]

    try:
        parsed = finance_import.parse_statement(
            body.content, body.source, body.account_id, rules
        )
    except finance_import.ImportError_ as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    ids = [r.external_id for r in parsed]
    existing: set[str] = set()
    # SQLite caps variables per statement, so chunk the lookup.
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]
        placeholders = ",".join("?" * len(chunk))
        async with db.execute(
            f"SELECT external_id FROM finances_transactions WHERE external_id IN ({placeholders})",
            chunk,
        ) as cur:
            existing.update(r["external_id"] for r in await cur.fetchall())

    account_currency = await _account_currency(db, body.account_id)
    foreign = sorted({r.currency for r in parsed if r.currency != account_currency})
    table = await _ensure_import_rates(db, parsed, account_currency)

    rows = []
    for r in parsed:
        d = finance_import.to_dict(r)
        d["duplicate"] = r.external_id in existing
        # Show what will be stored: the amount in the account's currency.
        if r.currency != account_currency:
            d["converted_amount"] = round(table.convert(r.amount, r.currency, account_currency, r.date), 2)
        rows.append(d)

    return {
        "rows": rows,
        "new_count": sum(1 for r in rows if not r["duplicate"]),
        "duplicate_count": sum(1 for r in rows if r["duplicate"]),
        "account_currency": account_currency,
        # Currencies that will be converted into the account's currency.
        "currencies": foreign,
    }


@router.post("/import/commit")
async def import_commit(body: ImportCommitIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Insert the reviewed rows. Duplicates are ignored rather than rejected, so
    re-importing an overlapping date range is safe and needs no user care."""
    account_currency = await _account_currency(db, body.account_id)
    table = await _ensure_import_rates(db, body.rows, account_currency)
    inserted = skipped = 0
    for row in body.rows:
        cur_code = row.currency.upper()
        # Stored in the account's currency; a converted row keeps the original.
        if cur_code == account_currency:
            amount, orig_amount, orig_currency = row.amount, None, None
        else:
            amount = round(table.convert(row.amount, cur_code, account_currency, row.date), 2)
            orig_amount, orig_currency = row.amount, cur_code
        cur = await db.execute(
            "INSERT OR IGNORE INTO finances_transactions "
            "(id, merchant, category, amount, date, type, account_id, currency, fx_rate, source, external_id, "
            " orig_amount, orig_currency) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), row.merchant, row.category, amount, row.date, row.type,
             body.account_id, account_currency, 1.0, body.source, row.external_id,
             orig_amount, orig_currency),
        )
        if cur.rowcount:
            inserted += 1
        else:
            skipped += 1
    await db.commit()
    return {"inserted": inserted, "skipped": skipped}


# ── Budgets & insights ────────────────────────────────────────────────────────

class BudgetIn(BaseModel):
    id: str
    category: str
    amount: float = 0
    period: str = "monthly"
    currency: str = "EUR"


class AllocateIn(BaseModel):
    allocations: list[dict]
    note: str = ""
    currency: str = "EUR"  # the currency the suggested amounts were shown in


async def _all_transactions(db) -> list[dict]:
    async with db.execute("SELECT * FROM finances_transactions ORDER BY date DESC") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("/budgets")
async def add_budget(body: BudgetIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_budgets (id, category, amount, period, currency) VALUES (?,?,?,?,?) "
        "ON CONFLICT(category) DO UPDATE SET amount=excluded.amount, period=excluded.period, currency=excluded.currency",
        (body.id, body.category.strip(), body.amount, body.period, body.currency.upper()),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/budgets/{budget_id}")
async def remove_budget(budget_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_budgets WHERE id = ?", (budget_id,))
    await db.commit()
    return {"ok": True}


async def _currencies_in_use(db) -> set[str]:
    out = {"GBP"}
    for table in ("finances_transactions", "finances_accounts", "finances_pots", "finances_budgets"):
        async with db.execute(f"SELECT DISTINCT currency FROM {table}") as cur:
            out.update((r["currency"] or "").upper() for r in await cur.fetchall())
    return {c for c in out if c}


async def _fx_for_ledger(db) -> "fx.FxTable":
    """Rates for every currency the ledger uses, back to its oldest transaction."""
    async with db.execute("SELECT MIN(date) AS d FROM finances_transactions") as cur:
        oldest = (await cur.fetchone())["d"]
    return await fx.ensure(db, await _currencies_in_use(db), since=oldest)


def _display_currency(currency: Optional[str]) -> str:
    c = (currency or "EUR").upper()
    if c not in fx.DISPLAY_CURRENCIES:
        raise HTTPException(400, f"Display currency must be one of {', '.join(fx.DISPLAY_CURRENCIES)}")
    return c


@router.get("/fx")
async def get_fx(user=Depends(get_current_user), db=Depends(get_db)):
    """Daily rates (1 EUR = rate CUR) for every currency in use, so the page can
    convert any amount on any date without another round trip."""
    table = await _fx_for_ledger(db)
    currencies = await _currencies_in_use(db)
    return {
        "base": fx.BASE,
        "rates": table.series(currencies),
        "missing": sorted(c for c in currencies if not table.has(c)),
    }


@router.get("/insights")
async def get_insights(month: Optional[str] = None, currency: Optional[str] = None,
                       user=Depends(get_current_user), db=Depends(get_db)):
    display = _display_currency(currency)
    table = await _fx_for_ledger(db)
    missing: set[str] = set()

    def conv(amount, frm, on=None) -> float:
        frm = (frm or display).upper()
        try:
            return table.convert(float(amount or 0), frm, display, on)
        except fx.NoRate:
            missing.add(frm)  # reported, never silently treated as 1:1
            return 0.0

    def value(t: dict) -> float:
        return conv(t.get("amount"), t.get("currency"), t.get("date"))

    transactions = await _all_transactions(db)

    async with db.execute("SELECT * FROM finances_budgets") as cur:
        budgets = [dict(r) for r in await cur.fetchall()]
    for b in budgets:
        b["native_amount"], b["amount"] = b["amount"], round(conv(b["amount"], b.get("currency")), 2)

    async with db.execute("SELECT * FROM finances_pots ORDER BY sort_order") as cur:
        pots = [dict(r) for r in await cur.fetchall()]
    for pot in pots:
        async with db.execute(
            "SELECT COALESCE(SUM(amount), 0) AS saved FROM finances_deposits WHERE pot_id = ?",
            (pot["id"],),
        ) as cur:
            saved = (await cur.fetchone())["saved"]
        pot["saved"] = conv(saved, pot.get("currency"))
        pot["target_amount"] = conv(pot["target_amount"], pot.get("currency"))

    status, unbudgeted = finance_insights.budget_status(budgets, transactions, month, value=value)
    surplus = finance_insights.surplus_for(transactions, month, value=value)

    return {
        "currency": display,
        "budgets": status,
        "unbudgeted": unbudgeted,
        "recurring": finance_insights.find_recurring(transactions, value=value),
        "surplus": surplus,
        "allocation": finance_insights.suggest_allocation(surplus["surplus"], pots),
        "missing_rates": sorted(missing),
    }


@router.post("/allocate")
async def allocate_surplus(body: AllocateIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Turn accepted allocation suggestions into pot deposits.

    Explicitly a separate, user-initiated call: /insights only ever suggests.
    """
    today = date.today().isoformat()
    table = await fx.ensure(db, [body.currency, "GBP"])
    async with db.execute("SELECT id, currency FROM finances_pots") as cur:
        pot_currency = {r["id"]: r["currency"] for r in await cur.fetchall()}
    created = 0
    for item in body.allocations:
        amount = float(item.get("amount") or 0)
        pot_id = item.get("pot_id")
        if not pot_id or amount <= 0:
            continue
        # Suggestions were shown in the display currency; deposits are kept in
        # the pot's own currency.
        try:
            amount = round(table.convert(amount, body.currency.upper(), pot_currency.get(pot_id, body.currency.upper())), 2)
        except fx.NoRate as exc:
            raise HTTPException(400, str(exc))
        await db.execute(
            "INSERT INTO finances_deposits (id, pot_id, amount, note, date) VALUES (?,?,?,?,?)",
            (str(uuid.uuid4()), pot_id, amount, body.note or "Monthly surplus", today),
        )
        created += 1
    await db.commit()
    return {"created": created}
