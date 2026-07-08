from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from database import get_db

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

    return {"pots": pots, "transactions": transactions, "accounts": accounts}


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
        "INSERT INTO finances_transactions (id, merchant, category, amount, date, type) VALUES (?,?,?,?,?,?)",
        (body.id, body.merchant, body.category, body.amount, body.date, body.type),
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
