"""
Auto-categorising transactions with an OpenAI model (the agent's model,
gpt-6-luna by default, via the Responses API).

What leaves the server: each distinct merchant description and whether it was
money in or out. Never amounts, dates, balances or account details. Unique
merchants are sent rather than rows, which also makes a 500-row statement a
few hundred short strings.

The model must answer from a fixed list (your categories plus a starter set)
through a strict JSON schema, so it can't invent "Food" beside "Groceries";
"" means unsure and leaves the row uncategorised. Assigned categories are
marked category_source = 'ai' so they can be told apart from your own.
"""
import asyncio
import json
import logging
import os
from typing import Iterable

import httpx

log = logging.getLogger(__name__)

BATCH = 100
TIMEOUT = 90

DEFAULT_CATEGORIES = [
    "Groceries", "Eating out", "Coffee", "Transport", "Travel", "Rent", "Bills",
    "Subscriptions", "Shopping", "Health", "Entertainment", "Personal care",
    "Gifts", "Giving", "Education", "Fees", "Cash", "Transfer",
    "Salary", "Refund", "Other income",
]


class ClassifyError(RuntimeError):
    """Classification couldn't run; the message reaches the user."""


def model_id() -> str:
    return os.getenv("FINANCE_CLASSIFY_MODEL") or os.getenv("AGENT_MODEL_ID") or "gpt-6-luna"


def configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def category_list(existing: Iterable[str]) -> list[str]:
    """Your categories first (exact spelling kept), then defaults not already
    there in some casing."""
    seen, out = set(), []
    for c in list(existing) + DEFAULT_CATEGORIES:
        c = (c or "").strip()
        if c and c.lower() not in seen:
            seen.add(c.lower())
            out.append(c)
    return out


INSTRUCTIONS = """You categorise personal bank transactions for one person living in Dublin, Ireland.
For each item you get the merchant/description exactly as the bank shows it and whether money went "out" or came "in".
Pick the single best category from the allowed list. Use "" when you genuinely can't tell (e.g. a person's name with no context, or an opaque reference).
Payment processors (SumUp, Square/SQ, Zettle) often prefix the real merchant name — categorise by the merchant after the prefix.
"Topped up account" / "Received money" style descriptions are transfers into the account.
"examples" shows how this person has categorised other merchants. Follow their conventions: reuse their categories the way they do (e.g. if they file a café under "Coffee", file similar cafés there too), and prefer their categories over the generic ones. Answer for every id."""


def _schema(categories: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "results": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "category": {"type": "string", "enum": categories + [""]},
                    },
                    "required": ["id", "category"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["results"],
        "additionalProperties": False,
    }


def _output_text(body: dict) -> str:
    """The text of a Responses API reply (raw HTTP has no output_text helper)."""
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    parts = []
    for item in body.get("output", []):
        if item.get("type") == "message":
            for c in item.get("content", []):
                if c.get("type") == "output_text":
                    parts.append(c.get("text", ""))
    return "".join(parts)


async def _call_model(items: list[dict], categories: list[str], examples: list[dict] | None = None) -> dict[int, str]:
    base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": model_id(),
        "instructions": INSTRUCTIONS,
        "input": json.dumps({"allowed_categories": categories, "examples": examples or [], "items": items}, ensure_ascii=False),
        "text": {"format": {"type": "json_schema", "name": "transaction_categories",
                            "schema": _schema(categories), "strict": True}},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(f"{base}/responses", json=payload,
                              headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"})
    if r.status_code >= 400:
        raise ClassifyError(f"The model request failed ({r.status_code}): {r.text[:200]}")
    try:
        results = json.loads(_output_text(r.json()))["results"]
    except (ValueError, KeyError, TypeError) as exc:
        raise ClassifyError("The model's reply wasn't the expected JSON") from exc
    return {int(x["id"]): x["category"] for x in results if isinstance(x, dict) and "id" in x}


async def classify(merchants: list[tuple[str, str]], categories: list[str],
                   examples: list[dict] | None = None) -> dict[tuple[str, str], str]:
    """Map (merchant, 'in'|'out') → category, for the ones the model was sure of.
    Batches run concurrently. Raises ClassifyError if nothing could be done."""
    if not configured():
        raise ClassifyError("Auto-categorising needs OPENAI_API_KEY on the server")
    keys = list(dict.fromkeys(merchants))
    if not keys:
        return {}
    allowed = {c for c in categories}
    batches = [keys[i:i + BATCH] for i in range(0, len(keys), BATCH)]

    async def run(batch):
        items = [{"id": i, "merchant": m, "direction": d} for i, (m, d) in enumerate(batch)]
        answers = await _call_model(items, categories, examples)
        return {batch[i]: c for i, c in answers.items() if 0 <= i < len(batch) and c in allowed}

    results = await asyncio.gather(*(run(b) for b in batches), return_exceptions=True)
    out, errors = {}, []
    for res in results:
        if isinstance(res, Exception):
            errors.append(res)
            log.warning("Classification batch failed: %s", res)
        else:
            out.update(res)
    if errors and not out:
        err = errors[0]
        raise err if isinstance(err, ClassifyError) else ClassifyError(f"Couldn't reach the model: {err}")
    return out
