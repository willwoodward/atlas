import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from database import get_db
import finance_import
import finance_insights

router = APIRouter(prefix="/api/finances", tags=["finances"])


# ── Pots ─────────────────────────────────────────────────────────────────────

class PotIn(BaseModel):
    id: str
    name: str
    color: str
    target_amount: float = 0
    notes: str = ""


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
    currency: str = "GBP"
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


class ImportCommitIn(BaseModel):
    source: str
    account_id: str
    rows: list[TransactionIn]
    fx_rates: dict[str, float] = {}


# ── Accounts ──────────────────────────────────────────────────────────────────

class AccountIn(BaseModel):
    id: str
    name: str
    institution: str = ""
    type: str = "checking"
    balance: float = 0


class AccountUpdate(BaseModel):
    balance: Optional[float] = None
    name: Optional[str] = None


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
        "INSERT INTO finances_pots (id, name, color, target_amount, notes, sort_order) VALUES (?,?,?,?,?,?)",
        (body.id, body.name, body.color, body.target_amount, body.notes, order),
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
         body.account_id, body.currency, body.fx_rate, body.source, body.external_id),
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
        "INSERT INTO finances_accounts (id, name, institution, type, balance) VALUES (?,?,?,?,?)",
        (body.id, body.name, body.institution, body.type, body.balance),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/accounts/{acc_id}")
async def update_account(acc_id: str, body: AccountUpdate, user=Depends(get_current_user), db=Depends(get_db)):
    if body.balance is not None:
        await db.execute("UPDATE finances_accounts SET balance = ? WHERE id = ?", (body.balance, acc_id))
    if body.name is not None:
        await db.execute("UPDATE finances_accounts SET name = ? WHERE id = ?", (body.name, acc_id))
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

    rows = []
    for r in parsed:
        d = finance_import.to_dict(r)
        d["duplicate"] = r.external_id in existing
        rows.append(d)

    currencies = sorted({r["currency"] for r in rows if r["currency"] != "GBP"})
    return {
        "rows": rows,
        "new_count": sum(1 for r in rows if not r["duplicate"]),
        "duplicate_count": sum(1 for r in rows if r["duplicate"]),
        "currencies": currencies,
    }


@router.post("/import/commit")
async def import_commit(body: ImportCommitIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Insert the reviewed rows. Duplicates are ignored rather than rejected, so
    re-importing an overlapping date range is safe and needs no user care."""
    inserted = skipped = 0
    for row in body.rows:
        rate = body.fx_rates.get(row.currency, 1.0) if row.currency != "GBP" else 1.0
        cur = await db.execute(
            "INSERT OR IGNORE INTO finances_transactions "
            "(id, merchant, category, amount, date, type, account_id, currency, fx_rate, source, external_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), row.merchant, row.category, row.amount, row.date, row.type,
             body.account_id, row.currency, rate, body.source, row.external_id),
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


class AllocateIn(BaseModel):
    allocations: list[dict]
    note: str = ""


async def _all_transactions(db) -> list[dict]:
    async with db.execute("SELECT * FROM finances_transactions ORDER BY date DESC") as cur:
        return [dict(r) for r in await cur.fetchall()]


@router.post("/budgets")
async def add_budget(body: BudgetIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_budgets (id, category, amount, period) VALUES (?,?,?,?) "
        "ON CONFLICT(category) DO UPDATE SET amount=excluded.amount, period=excluded.period",
        (body.id, body.category.strip(), body.amount, body.period),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/budgets/{budget_id}")
async def remove_budget(budget_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_budgets WHERE id = ?", (budget_id,))
    await db.commit()
    return {"ok": True}


@router.get("/insights")
async def get_insights(month: Optional[str] = None,
                       user=Depends(get_current_user), db=Depends(get_db)):
    transactions = await _all_transactions(db)

    async with db.execute("SELECT * FROM finances_budgets") as cur:
        budgets = [dict(r) for r in await cur.fetchall()]

    async with db.execute("SELECT * FROM finances_pots ORDER BY sort_order") as cur:
        pots = [dict(r) for r in await cur.fetchall()]
    for pot in pots:
        async with db.execute(
            "SELECT COALESCE(SUM(amount), 0) AS saved FROM finances_deposits WHERE pot_id = ?",
            (pot["id"],),
        ) as cur:
            pot["saved"] = (await cur.fetchone())["saved"]

    status, unbudgeted = finance_insights.budget_status(budgets, transactions, month)
    surplus = finance_insights.surplus_for(transactions, month)

    return {
        "budgets": status,
        "unbudgeted": unbudgeted,
        "recurring": finance_insights.find_recurring(transactions),
        "surplus": surplus,
        "allocation": finance_insights.suggest_allocation(surplus["surplus"], pots),
    }


@router.post("/allocate")
async def allocate_surplus(body: AllocateIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Turn accepted allocation suggestions into pot deposits.

    Explicitly a separate, user-initiated call: /insights only ever suggests.
    """
    today = date.today().isoformat()
    created = 0
    for item in body.allocations:
        amount = float(item.get("amount") or 0)
        pot_id = item.get("pot_id")
        if not pot_id or amount <= 0:
            continue
        await db.execute(
            "INSERT INTO finances_deposits (id, pot_id, amount, note, date) VALUES (?,?,?,?,?)",
            (str(uuid.uuid4()), pot_id, amount, body.note or "Monthly surplus", today),
        )
        created += 1
    await db.commit()
    return {"created": created}
