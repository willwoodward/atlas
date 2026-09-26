"""
Bank statement import.

Neither Barclays nor Wise offers a usable read-only API for a UK personal
account, so the CSV export is the ingest path rather than a stopgap. Everything
here is deliberately pure — parse, dedupe, categorise — so the rules can be
tested without a database, and so a future Open Banking producer can feed the
same normalisation step by emitting `ParsedRow`s.

Amounts are stored the way the rest of the app stores them: a positive `amount`
plus a `type` of income/expense, never a signed number.
"""
import csv
import hashlib
import io
import re
from dataclasses import dataclass, asdict, field
from datetime import datetime
from typing import Optional


class ImportError_(ValueError):
    """A statement we could not make sense of. The message reaches the user."""


@dataclass
class ParsedRow:
    external_id: str
    date: str           # YYYY-MM-DD
    merchant: str
    amount: float       # always positive
    currency: str
    type: str           # income | expense
    category: str = ""
    raw: str = ""       # original description, kept for rule matching / audit


# ── Header handling ───────────────────────────────────────────────────────────
#
# Banks rename columns between export versions and Wise varies them by locale,
# so columns are located by candidate name rather than by position.

def _norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (h or "").lower())


def _pick(row: dict, *candidates: str) -> Optional[str]:
    for cand in candidates:
        key = _norm_header(cand)
        if key in row and row[key] not in (None, ""):
            return row[key].strip()
    return None


def _rows(content: str) -> list[dict]:
    text = content.lstrip("﻿")
    try:
        reader = csv.DictReader(io.StringIO(text))
        out = []
        for raw in reader:
            out.append({_norm_header(k): (v or "") for k, v in raw.items() if k})
        return out
    except csv.Error as exc:
        raise ImportError_(f"Could not read the CSV: {exc}") from exc


_DATE_FORMATS = ["%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y", "%d/%m/%y"]


def _parse_date(value: str) -> str:
    """UK exports are day-first. ISO is accepted too; US month-first is not,
    because 03/04 is genuinely ambiguous and guessing would silently corrupt."""
    v = (value or "").strip()
    if not v:
        raise ImportError_("A row has no date")
    v = v.split("T")[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ImportError_(f"Unrecognised date format: {value!r}")


def _parse_amount(value: str) -> float:
    v = (value or "").strip().replace(",", "").replace("£", "").replace("\xa0", "")
    if not v:
        raise ImportError_("A row has no amount")
    if v.startswith("(") and v.endswith(")"):   # (12.34) means -12.34
        v = "-" + v[1:-1]
    try:
        return float(v)
    except ValueError:
        raise ImportError_(f"Unrecognised amount: {value!r}") from None


def _clean(desc: str) -> str:
    return re.sub(r"\s+", " ", (desc or "").strip())


# ── Profiles ──────────────────────────────────────────────────────────────────

def _parse_barclays(rows: list[dict]) -> list[ParsedRow]:
    """Barclays exports `Number,Date,Account,Amount,Subcategory,Memo` with a
    single signed Amount — there is no type column, so the sign carries it."""
    out = []
    for r in rows:
        if not any(r.values()):
            continue
        amount = _parse_amount(_pick(r, "Amount") or "")
        desc = _clean(_pick(r, "Memo", "Description", "Subcategory") or "Unknown")
        out.append(ParsedRow(
            external_id="",
            date=_parse_date(_pick(r, "Date") or ""),
            merchant=desc,
            amount=abs(amount),
            currency="GBP",
            type="income" if amount >= 0 else "expense",
            raw=desc,
        ))
    return out


def _parse_wise(rows: list[dict]) -> list[ParsedRow]:
    """Wise gives a stable per-transaction ID, so these dedupe exactly rather
    than by content hash. Amounts are per-currency — no conversion happens here;
    the rate is applied at commit time and stored alongside the row."""
    out = []
    for r in rows:
        if not any(r.values()):
            continue
        amount = _parse_amount(_pick(r, "Amount") or "")
        desc = _clean(
            _pick(r, "Merchant", "Description", "Payee Name", "Payment Reference")
            or "Unknown"
        )
        tw_id = _pick(r, "TransferWise ID", "Wise ID", "ID", "Transaction ID")
        out.append(ParsedRow(
            external_id=f"wise:{tw_id}" if tw_id else "",
            date=_parse_date(_pick(r, "Date", "Created on") or ""),
            merchant=desc,
            amount=abs(amount),
            currency=(_pick(r, "Currency") or "GBP").upper(),
            type="income" if amount >= 0 else "expense",
            raw=desc,
        ))
    return out


PROFILES = {
    "barclays_csv": ("Barclays (CSV)", _parse_barclays),
    "wise_csv": ("Wise (CSV)", _parse_wise),
}


# ── Dedupe ────────────────────────────────────────────────────────────────────

def _content_id(source: str, account_id: str, row: ParsedRow, ordinal: int) -> str:
    """A stable identity for exports that carry no transaction ID.

    Two genuinely distinct but identical purchases on one day (two £3 coffees)
    would otherwise collapse into one, so the ordinal of the repeat within the
    batch is part of the key. That holds as long as a re-export covers the same
    window; a re-export that splits a repeated pair across a date boundary can
    re-import one of them. Wise avoids this entirely by supplying a real ID.
    """
    signed = row.amount if row.type == "income" else -row.amount
    key = f"{source}|{account_id}|{row.date}|{signed:.2f}|{row.raw.lower()}|{ordinal}"
    return f"{source}:{hashlib.sha256(key.encode()).hexdigest()[:24]}"


def assign_ids(rows: list[ParsedRow], source: str, account_id: str) -> list[ParsedRow]:
    seen: dict[str, int] = {}
    for row in rows:
        if row.external_id:
            continue
        stub = f"{row.date}|{row.amount}|{row.type}|{row.raw.lower()}"
        ordinal = seen.get(stub, 0)
        seen[stub] = ordinal + 1
        row.external_id = _content_id(source, account_id, row, ordinal)
    return rows


# ── Categorisation ────────────────────────────────────────────────────────────

def apply_rules(rows: list[ParsedRow], rules: list[dict]) -> list[ParsedRow]:
    """First matching rule wins, so rule order is meaningful. Matching is a
    case-insensitive substring on the bank's own description — predictable
    enough that a user can guess why a rule fired."""
    for row in rows:
        if row.category:
            continue
        haystack = row.raw.lower()
        for rule in rules:
            pattern = (rule.get("pattern") or "").strip().lower()
            if pattern and pattern in haystack:
                row.category = rule.get("category") or ""
                break
    return rows


def parse_statement(content: str, source: str, account_id: str,
                    rules: list[dict] | None = None) -> list[ParsedRow]:
    if source not in PROFILES:
        raise ImportError_(f"Unknown statement source: {source}")
    rows = _rows(content)
    if not rows:
        raise ImportError_("That file has no rows")
    parsed = PROFILES[source][1](rows)
    if not parsed:
        raise ImportError_("No transactions found in that file")
    assign_ids(parsed, source, account_id)
    apply_rules(parsed, rules or [])
    parsed.sort(key=lambda r: r.date, reverse=True)
    return parsed


def to_dict(row: ParsedRow) -> dict:
    return asdict(row)
