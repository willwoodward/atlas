"""
Employment and compensation.

Separate from /api/finances because it answers a different question: not "what
did I spend" but "what am I owed, and when". The two are joined only in the UI.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

import compensation
from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/api/employment", tags=["employment"])


class EmploymentIn(BaseModel):
    id: str
    employer: str
    title: str = ""
    location: str = ""
    currency: str = "EUR"
    start_date: str = ""
    effective_tax_rate: float = 0
    notes: str = ""


class EmploymentUpdate(BaseModel):
    employer: Optional[str] = None
    title: Optional[str] = None
    location: Optional[str] = None
    currency: Optional[str] = None
    start_date: Optional[str] = None
    effective_tax_rate: Optional[float] = None
    notes: Optional[str] = None


class ComponentIn(BaseModel):
    id: str
    kind: str = "base"          # base | oncall | bonus | other
    label: str
    amount: float = 0
    currency: str = "EUR"
    cadence: str = "annual"     # monthly | annual | one_off
    start_date: str = ""
    end_date: str = ""
    is_gross: bool = True
    notes: str = ""


class GrantIn(BaseModel):
    id: str
    label: str
    grant_date: str = ""
    total_units: float = 0
    symbol: str = "AMZN"
    currency: str = "USD"
    notes: str = ""


class VestIn(BaseModel):
    id: str
    vest_date: str
    units: float = 0


class PriceIn(BaseModel):
    symbol: str
    price: float
    currency: str = "USD"
    as_of: str = ""


class FxIn(BaseModel):
    currency: str
    rate_to_gbp: float
    as_of: str = ""


VALID_KINDS = {"base", "oncall", "bonus", "other"}
VALID_CADENCES = {"monthly", "annual", "one_off"}


async def _load(db):
    async with db.execute("SELECT * FROM finances_employment") as c:
        employments = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT * FROM finances_comp_components") as c:
        components = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT * FROM finances_rsu_grants") as c:
        grants = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT * FROM finances_vesting_events ORDER BY vest_date") as c:
        vests = [dict(r) for r in await c.fetchall()]
    async with db.execute("SELECT * FROM finances_market_prices") as c:
        prices = {r["symbol"]: dict(r) for r in await c.fetchall()}
    async with db.execute("SELECT * FROM finances_fx_rates") as c:
        fx = {r["currency"]: r["rate_to_gbp"] for r in await c.fetchall()}
    fx.setdefault("GBP", 1.0)
    return employments, components, grants, vests, prices, fx


@router.get("")
async def get_employment(user=Depends(get_current_user), db=Depends(get_db)):
    employments, components, grants, vests, prices, fx = await _load(db)

    tax_rate = employments[0]["effective_tax_rate"] if employments else 0
    projection = compensation.project(components, grants, vests, prices, fx, tax_rate)

    for g in grants:
        g["vests"] = [v for v in vests if v["grant_id"] == g["id"]]
    unvested = compensation.unvested_units(grants, vests)
    for g in grants:
        g["unvested_units"] = unvested.get(g["id"], 0)

    return {
        "employments": employments,
        "components": components,
        "grants": grants,
        "prices": list(prices.values()),
        "fx": [{"currency": k, "rate_to_gbp": v} for k, v in fx.items()],
        "projection": projection,
        "summary": compensation.summarise(projection),
    }


# ── Employment ────────────────────────────────────────────────────────────────

@router.post("")
async def add_employment(body: EmploymentIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_employment "
        "(id, employer, title, location, currency, start_date, effective_tax_rate, notes) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (body.id, body.employer, body.title, body.location, body.currency,
         body.start_date, body.effective_tax_rate, body.notes),
    )
    await db.commit()
    return {"ok": True}


@router.patch("/{emp_id}")
async def update_employment(emp_id: str, body: EmploymentUpdate,
                            user=Depends(get_current_user), db=Depends(get_db)):
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return {"ok": True}
    sets = ", ".join(f"{k} = ?" for k in fields)
    await db.execute(f"UPDATE finances_employment SET {sets} WHERE id = ?",
                     (*fields.values(), emp_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{emp_id}")
async def remove_employment(emp_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_employment WHERE id = ?", (emp_id,))
    await db.execute("DELETE FROM finances_comp_components WHERE employment_id = ?", (emp_id,))
    async with db.execute("SELECT id FROM finances_rsu_grants WHERE employment_id = ?", (emp_id,)) as c:
        grant_ids = [r["id"] for r in await c.fetchall()]
    for gid in grant_ids:
        await db.execute("DELETE FROM finances_vesting_events WHERE grant_id = ?", (gid,))
    await db.execute("DELETE FROM finances_rsu_grants WHERE employment_id = ?", (emp_id,))
    await db.commit()
    return {"ok": True}


# ── Pay components ────────────────────────────────────────────────────────────

@router.post("/{emp_id}/components")
async def add_component(emp_id: str, body: ComponentIn,
                        user=Depends(get_current_user), db=Depends(get_db)):
    if body.kind not in VALID_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(VALID_KINDS)}")
    if body.cadence not in VALID_CADENCES:
        raise HTTPException(400, f"cadence must be one of {sorted(VALID_CADENCES)}")
    if body.cadence == "one_off" and not body.start_date:
        raise HTTPException(400, "a one-off payment needs a date")
    await db.execute(
        "INSERT INTO finances_comp_components "
        "(id, employment_id, kind, label, amount, currency, cadence, start_date, end_date, is_gross, notes) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (body.id, emp_id, body.kind, body.label, body.amount, body.currency,
         body.cadence, body.start_date, body.end_date, int(body.is_gross), body.notes),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/components/{comp_id}")
async def remove_component(comp_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_comp_components WHERE id = ?", (comp_id,))
    await db.commit()
    return {"ok": True}


# ── Equity ────────────────────────────────────────────────────────────────────

@router.post("/{emp_id}/grants")
async def add_grant(emp_id: str, body: GrantIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_rsu_grants "
        "(id, employment_id, label, grant_date, total_units, symbol, currency, notes) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (body.id, emp_id, body.label, body.grant_date, body.total_units,
         body.symbol.upper(), body.currency, body.notes),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/grants/{grant_id}")
async def remove_grant(grant_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_vesting_events WHERE grant_id = ?", (grant_id,))
    await db.execute("DELETE FROM finances_rsu_grants WHERE id = ?", (grant_id,))
    await db.commit()
    return {"ok": True}


@router.post("/grants/{grant_id}/vests")
async def add_vest(grant_id: str, body: VestIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_vesting_events (id, grant_id, vest_date, units) VALUES (?,?,?,?)",
        (body.id, grant_id, body.vest_date, body.units),
    )
    await db.commit()
    return {"ok": True}


@router.delete("/vests/{vest_id}")
async def remove_vest(vest_id: str, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute("DELETE FROM finances_vesting_events WHERE id = ?", (vest_id,))
    await db.commit()
    return {"ok": True}


# ── Valuation inputs ──────────────────────────────────────────────────────────

@router.put("/prices")
async def set_price(body: PriceIn, user=Depends(get_current_user), db=Depends(get_db)):
    """Share price, maintained by hand. Nothing here calls a market API."""
    await db.execute(
        "INSERT INTO finances_market_prices (symbol, price, currency, as_of) VALUES (?,?,?,?) "
        "ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, currency=excluded.currency, as_of=excluded.as_of",
        (body.symbol.upper(), body.price, body.currency, body.as_of or date.today().isoformat()),
    )
    await db.commit()
    return {"ok": True}


@router.put("/fx")
async def set_fx(body: FxIn, user=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "INSERT INTO finances_fx_rates (currency, rate_to_gbp, as_of) VALUES (?,?,?) "
        "ON CONFLICT(currency) DO UPDATE SET rate_to_gbp=excluded.rate_to_gbp, as_of=excluded.as_of",
        (body.currency.upper(), body.rate_to_gbp, body.as_of or date.today().isoformat()),
    )
    await db.commit()
    return {"ok": True}
