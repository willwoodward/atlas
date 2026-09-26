"""
Weekly training volume, computed from Strava activities in memory.

Nothing here is stored. Strava's API policy forbids keeping their data beyond a
seven-day transient cache, and derived figures count as data derived from it,
so the weekly chart is recomputed from a live fetch every time rather than
accumulated into a table. Pure functions only, so the arithmetic is testable
without a network.
"""
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

# Strava's sport_type is fine-grained; the dashboard cares about three things.
SPORT_GROUPS = {
    "run": {"Run", "TrailRun", "VirtualRun"},
    "swim": {"Swim"},
    "ride": {"Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide",
             "EMountainBikeRide", "Velomobile", "Handcycle"},
}
SPORTS = ("run", "swim", "ride")


def sport_of(activity: dict) -> Optional[str]:
    kind = activity.get("sport_type") or activity.get("type") or ""
    for group, kinds in SPORT_GROUPS.items():
        if kind in kinds:
            return group
    return None


def local_date(activity: dict) -> date:
    """`start_date_local` is wall-clock time with a misleading trailing Z. Take
    the date as written — converting it from "UTC" would shift early-morning
    swims into the previous day."""
    raw = activity.get("start_date_local") or activity.get("start_date") or ""
    return datetime.strptime(raw[:10], "%Y-%m-%d").date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())   # Monday, matching Strava's weekly view


def _empty():
    return {"distance": 0.0, "moving_time": 0, "count": 0, "elevation": 0.0}


def weekly(activities: Iterable[dict], weeks: int = 12,
           today: Optional[date] = None) -> list[dict]:
    """Per-week totals for each sport, oldest first, current week last.

    Weeks with no activity are present as zeros: a gap in the chart is
    information, and dropping empty weeks would make a month off look like
    continuous training.
    """
    today = today or date.today()
    current = week_start(today)
    starts = [current - timedelta(weeks=i) for i in range(weeks - 1, -1, -1)]
    buckets = {s: {sport: _empty() for sport in SPORTS} for s in starts}

    for a in activities:
        sport = sport_of(a)
        if not sport:
            continue
        ws = week_start(local_date(a))
        if ws not in buckets:
            continue
        b = buckets[ws][sport]
        b["distance"] += float(a.get("distance") or 0)
        b["moving_time"] += int(a.get("moving_time") or 0)
        b["elevation"] += float(a.get("total_elevation_gain") or 0)
        b["count"] += 1

    out = []
    for s in starts:
        row = {"week_start": s.isoformat(), "current": s == current}
        for sport in SPORTS:
            v = buckets[s][sport]
            row[sport] = {**v, "distance": round(v["distance"], 1), "elevation": round(v["elevation"], 1)}
        row["total_time"] = sum(buckets[s][sp]["moving_time"] for sp in SPORTS)
        out.append(row)
    return out


def pace(sport: str, distance_m: float, moving_s: int) -> Optional[float]:
    """The unit each sport is actually talked about in.

    run  → seconds per km
    swim → seconds per 100 m
    ride → km/h
    """
    if not distance_m or not moving_s:
        return None
    if sport == "run":
        return round(moving_s / (distance_m / 1000), 1)
    if sport == "swim":
        return round(moving_s / (distance_m / 100), 1)
    if sport == "ride":
        return round((distance_m / 1000) / (moving_s / 3600), 1)
    return None


def streak(rows: list[dict]) -> int:
    """Consecutive weeks with at least one session, counting back from now.

    The current week is only counted if it already has a session, so the streak
    does not reset to zero every Monday morning.
    """
    n = 0
    for i, row in enumerate(reversed(rows)):
        active = any(row[sp]["count"] for sp in SPORTS)
        if active:
            n += 1
        elif i == 0 and row["current"]:
            continue
        else:
            break
    return n


def summarise(rows: list[dict], activities: Iterable[dict]) -> dict:
    """Headline figures per sport: this week, typical week, and bests."""
    activities = list(activities)
    completed = [r for r in rows if not r["current"]]
    recent4 = completed[-4:]
    this_week = rows[-1] if rows else None

    out = {"streak_weeks": streak(rows), "sports": {}}
    earliest = rows[0]["week_start"] if rows else None

    for sport in SPORTS:
        mine = [a for a in activities if sport_of(a) == sport
                and (earliest is None or local_date(a).isoformat() >= earliest)]
        longest = max(mine, key=lambda a: float(a.get("distance") or 0), default=None)
        total_d = sum(float(a.get("distance") or 0) for a in mine)
        total_t = sum(int(a.get("moving_time") or 0) for a in mine)
        hrs = [float(a["average_heartrate"]) for a in mine if a.get("average_heartrate")]
        avg4 = (sum(r[sport]["distance"] for r in recent4) / len(recent4)) if recent4 else 0

        out["sports"][sport] = {
            "this_week": this_week[sport] if this_week else _empty(),
            "avg_week_4": round(avg4, 1),
            "sessions": len(mine),
            "total_distance": round(total_d, 1),
            "total_time": total_t,
            "avg_pace": pace(sport, total_d, total_t),
            "avg_heartrate": round(sum(hrs) / len(hrs)) if hrs else None,
            "longest": _brief(longest) if longest else None,
        }
    return out


def _brief(a: dict) -> dict:
    sport = sport_of(a)
    d = float(a.get("distance") or 0)
    t = int(a.get("moving_time") or 0)
    return {
        "id": a.get("id"),
        "name": a.get("name", ""),
        "sport": sport,
        "date": local_date(a).isoformat(),
        "distance": round(d, 1),
        "moving_time": t,
        "elevation": round(float(a.get("total_elevation_gain") or 0), 1),
        "average_heartrate": a.get("average_heartrate"),
        "pace": pace(sport, d, t),
        # Strava's brand guidelines require a way back to the original activity.
        "url": f"https://www.strava.com/activities/{a.get('id')}",
    }


def recent(activities: Iterable[dict], limit: int = 8) -> list[dict]:
    mine = [a for a in activities if sport_of(a)]
    mine.sort(key=lambda a: a.get("start_date_local") or "", reverse=True)
    return [_brief(a) for a in mine[:limit]]
