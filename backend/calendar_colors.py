"""
Google Calendar colours, inferred from an event's title.

Atlas draws events in its own colours (kept on the Google event as a private
extended property, see mcp_server). The colour Google Calendar shows is set
separately, from these rules, so both calendars stay readable while the user
uses both.

Rules are case-insensitive regexes tried in order; the first match wins and
anything unmatched gets the fallback. "default" means no colour of its own
(the calendar's colour). The frontend runs the same matching
(frontend/src/lib/calendarColors.js) for events it creates directly.
"""
import json
import re

SETTINGS_KEY = "calendar.color_rules"

GCAL_COLOR_IDS = {
    "lavender": "1", "sage": "2", "grape": "3", "flamingo": "4", "banana": "5", "tangerine": "6",
    "peacock": "7", "graphite": "8", "blueberry": "9", "basil": "10", "tomato": "11",
}
CHOICES = [*GCAL_COLOR_IDS, "default"]

DEFAULT_RULES = {
    "rules": [
        {"label": "Sleep", "pattern": r"\bsleep\b|\bnap\b", "color": "banana"},
        {"label": "Important", "pattern": r"!|\bimportant\b|\bdeadline\b|\bexam\b|\binterview\b|\bflight\b|\bdoctor\b|\bdentist\b|\bhospital\b", "color": "banana"},
        {"label": "Meals on my own", "pattern": r"^\s*(breakfast|brunch|lunch|dinner)\s*$", "color": "default"},
        {"label": "Work", "pattern": r"\bwork\b|\boffice\b|\bshift\b|\bmeeting\b|stand-?up|\b1:1\b", "color": "sage"},
        {"label": "Church", "pattern": r"church|\bbible\b|\bprayer\b|worship|sermon|small group", "color": "grape"},
        {"label": "Sport", "pattern": r"\bgym\b|\brun\b|running|parkrun|swim|football|climb|tennis|squash|padel|cycl|\bbike\b|workout|exercise|yoga|pilates|\bhike\b", "color": "blueberry"},
        {"label": "Friends", "pattern": r"\bwith\b|&|\bdrinks\b|\bpub\b|party|birthday|catch[ -]?up|hang ?out", "color": "flamingo"},
    ],
    "fallback": "lavender",
}


def _valid(cfg) -> bool:
    return (isinstance(cfg, dict) and isinstance(cfg.get("rules"), list)
            and all(isinstance(r, dict) and isinstance(r.get("pattern"), str) and r.get("color") in CHOICES for r in cfg["rules"])
            and cfg.get("fallback") in CHOICES)


async def get_rules(db) -> dict:
    async with db.execute("SELECT value FROM app_settings WHERE key = ?", (SETTINGS_KEY,)) as c:
        row = await c.fetchone()
    if row:
        try:
            cfg = json.loads(row[0])
            if _valid(cfg):
                return cfg
        except ValueError:
            pass
    return DEFAULT_RULES


async def set_rules(db, cfg: dict) -> None:
    if not _valid(cfg):
        raise ValueError("Each rule needs a pattern and one of: " + ", ".join(CHOICES))
    await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", (SETTINGS_KEY, json.dumps(cfg)))
    await db.commit()


def color_name_for(title: str, cfg: dict) -> str:
    """The Google colour name a title gets (first matching rule, else the fallback)."""
    for rule in cfg["rules"]:
        try:
            if re.search(rule["pattern"], title or "", re.IGNORECASE):
                return rule["color"]
        except re.error:
            continue  # a broken pattern never blocks the others
    return cfg["fallback"]


def color_id_for(title: str, cfg: dict) -> str | None:
    """colorId to send to Google; None = the calendar's own colour."""
    return GCAL_COLOR_IDS.get(color_name_for(title, cfg))
