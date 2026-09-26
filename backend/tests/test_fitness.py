"""
Fitness: weekly Strava volume, the Strava connection, and the gym log.

Beyond the arithmetic, three properties are tested because breaking any of them
would breach Strava's API terms rather than just produce a bug:

- Strava activity data is never written to the database.
- No MCP tool can read Strava data (the assistant runs on a third-party model).
- Disconnecting deletes everything Strava-derived.
"""
import json
import time
from datetime import date

import httpx
import pytest

import fitness_stats as fs


def act(id, sport, day, distance=0, moving=0, elev=0, hr=None, name="Activity"):
    a = {"id": id, "name": name, "sport_type": sport, "start_date_local": f"{day}T07:30:00Z",
         "distance": distance, "moving_time": moving, "total_elevation_gain": elev}
    if hr:
        a["average_heartrate"] = hr
    return a


TODAY = date(2026, 9, 24)   # a Thursday; its week starts Monday 21 Sep


# ── Weekly aggregation ────────────────────────────────────────────────────────

def test_sports_are_grouped_from_strava_types():
    assert fs.sport_of({"sport_type": "TrailRun"}) == "run"
    assert fs.sport_of({"sport_type": "GravelRide"}) == "ride"
    assert fs.sport_of({"sport_type": "Swim"}) == "swim"
    assert fs.sport_of({"sport_type": "Yoga"}) is None


def test_weeks_start_on_monday_and_include_empty_weeks():
    rows = fs.weekly([act(1, "Run", "2026-09-22", 5000, 1500)], weeks=4, today=TODAY)
    assert [r["week_start"] for r in rows] == ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]
    assert rows[-1]["current"] is True
    assert rows[0]["run"]["distance"] == 0          # a gap is data, not omitted


def test_distances_sum_per_sport_per_week():
    acts = [act(1, "Swim", "2026-09-21", 1250, 1800),
            act(2, "Swim", "2026-09-23", 1500, 2100),
            act(3, "Run", "2026-09-22", 5000, 1560),
            act(4, "Ride", "2026-09-24", 42000, 5400, elev=380)]
    wk = fs.weekly(acts, weeks=2, today=TODAY)[-1]
    assert wk["swim"]["distance"] == 2750 and wk["swim"]["count"] == 2
    assert wk["run"]["distance"] == 5000
    assert wk["ride"]["elevation"] == 380
    assert wk["total_time"] == 1800 + 2100 + 1560 + 5400


def test_early_morning_activity_stays_on_its_local_day():
    """start_date_local carries a fake 'Z'; treating it as UTC would move a
    Monday 6am swim into the previous week."""
    rows = fs.weekly([act(1, "Swim", "2026-09-21", 1000, 1200)], weeks=2, today=TODAY)
    assert rows[-1]["swim"]["distance"] == 1000
    assert rows[0]["swim"]["distance"] == 0


def test_activities_outside_the_window_and_other_sports_are_ignored():
    acts = [act(1, "Run", "2025-01-01", 10000, 3000), act(2, "Yoga", "2026-09-22", 0, 3600)]
    rows = fs.weekly(acts, weeks=4, today=TODAY)
    assert all(r["run"]["count"] == 0 for r in rows)
    assert all(r["total_time"] == 0 for r in rows)


# ── Pace, streak, summary ─────────────────────────────────────────────────────

def test_pace_uses_each_sports_own_unit():
    assert fs.pace("run", 5000, 1500) == 300.0      # 5:00 /km
    assert fs.pace("swim", 1000, 1200) == 120.0     # 2:00 /100m
    assert fs.pace("ride", 30000, 3600) == 30.0     # 30 km/h
    assert fs.pace("run", 0, 100) is None


def test_streak_does_not_reset_on_monday_morning():
    acts = [act(i, "Run", d, 5000, 1500) for i, d in enumerate(["2026-09-02", "2026-09-09", "2026-09-16"])]
    rows = fs.weekly(acts, weeks=6, today=TODAY)    # current week is empty so far
    assert fs.streak(rows) == 3


def test_streak_breaks_on_a_missed_week():
    acts = [act(1, "Run", "2026-09-02", 5000, 1500), act(2, "Run", "2026-09-16", 5000, 1500)]
    assert fs.streak(fs.weekly(acts, weeks=6, today=TODAY)) == 1


def test_summary_average_excludes_the_unfinished_week():
    acts = [act(i, "Run", d, 10000, 3000) for i, d in
            enumerate(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-15"])]
    acts.append(act(99, "Run", "2026-09-22", 1000, 300))
    rows = fs.weekly(acts, weeks=6, today=TODAY)
    s = fs.summarise(rows, acts)["sports"]["run"]
    # The average is over the last four *completed* weeks; the current week's
    # 1 km must not drag it down.
    last4 = [r["run"]["distance"] for r in rows if not r["current"]][-4:]
    assert s["avg_week_4"] == pytest.approx(sum(last4) / 4)
    assert s["this_week"]["distance"] == 1000


def test_summary_longest_and_heart_rate():
    acts = [act(1, "Ride", "2026-09-10", 30000, 4000, hr=140),
            act(2, "Ride", "2026-09-20", 65000, 9000, hr=150, name="Wicklow loop")]
    s = fs.summarise(fs.weekly(acts, weeks=4, today=TODAY), acts)["sports"]["ride"]
    assert s["longest"]["name"] == "Wicklow loop"
    assert s["longest"]["url"] == "https://www.strava.com/activities/2"
    assert s["avg_heartrate"] == 145


def test_recent_is_newest_first_and_skips_other_sports():
    acts = [act(1, "Run", "2026-09-01", 5000, 1500), act(2, "Yoga", "2026-09-20"),
            act(3, "Swim", "2026-09-15", 1250, 1500)]
    assert [r["id"] for r in fs.recent(acts)] == [3, 1]


# ── A fake Strava ─────────────────────────────────────────────────────────────

class FakeStrava:
    """Just enough of Strava's API to exercise the client, including refresh
    token rotation, revocation and rate limiting."""

    def __init__(self):
        self.activities = [act(11, "Run", "2026-09-22", 5000, 1500),
                           act(12, "Swim", "2026-09-23", 1250, 1800)]
        self.refresh_tokens = {"r0"}
        self.calls = []
        self.revoked = False
        self.rate_limited = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(path)
        if path == "/oauth/token":
            form = dict(httpx.QueryParams(request.content.decode()))
            if form.get("grant_type") == "authorization_code":
                return httpx.Response(200, json={"access_token": "a1", "refresh_token": "r1",
                                                 "expires_at": int(time.time()) + 21600,
                                                 "athlete": {"id": 777, "firstname": "W"}})
            if self.revoked or form.get("refresh_token") not in self.refresh_tokens:
                return httpx.Response(400, json={"message": "Bad Request"})
            # Rotation: the old token dies the moment a new one is issued.
            self.refresh_tokens = {"r-next"}
            return httpx.Response(200, json={"access_token": "a-next", "refresh_token": "r-next",
                                             "expires_at": int(time.time()) + 21600})
        if path == "/oauth/deauthorize":
            self.revoked = True
            return httpx.Response(200, json={})
        if self.rate_limited:
            return httpx.Response(429, json={"message": "Rate Limit Exceeded"})
        if self.revoked:
            return httpx.Response(401, json={"message": "Authorization Error"})
        if path == "/api/v3/athlete/activities":
            page = int(request.url.params.get("page", 1))
            return httpx.Response(200, json=self.activities if page == 1 else [])
        if path == "/api/v3/athletes/777/stats":
            return httpx.Response(200, json={"ytd_run_totals": {"count": 40, "distance": 210000.0},
                                             "ytd_swim_totals": {"count": 12, "distance": 15000.0},
                                             "ytd_ride_totals": {"count": 0, "distance": 0.0},
                                             "all_run_totals": {"count": 300}, "all_swim_totals": {},
                                             "all_ride_totals": {}})
        return httpx.Response(404)


@pytest.fixture
def fake_strava(monkeypatch):
    import strava_client
    fake = FakeStrava()
    monkeypatch.setattr(strava_client, "STRAVA_CLIENT_ID", "123")
    monkeypatch.setattr(strava_client, "STRAVA_CLIENT_SECRET", "shh")
    monkeypatch.setattr(strava_client, "_client",
                        lambda **kw: httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    strava_client.purge_cache()
    strava_client._states.clear()
    yield fake
    strava_client.purge_cache()


async def _connect(client, auth):
    r = await client.post("/api/fitness/strava/authorize",
                          json={"redirect_uri": "http://localhost:5173/atlas/"}, headers=auth)
    assert r.status_code == 200, r.text
    state = dict(httpx.URL(r.json()["url"]).params)["state"]
    r = await client.post("/api/fitness/strava/exchange",
                          json={"code": "c", "state": state, "scope": "read,activity:read_all"}, headers=auth)
    assert r.status_code == 200, r.text


async def _raw(sql):
    import aiosqlite
    from database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql) as cur:
            return [dict(r) for r in await cur.fetchall()]


# ── Connection ────────────────────────────────────────────────────────────────

async def test_status_reports_unconfigured_without_credentials(client, auth, monkeypatch):
    import strava_client
    monkeypatch.setattr(strava_client, "STRAVA_CLIENT_ID", "")
    body = (await client.get("/api/fitness/strava/status", headers=auth)).json()
    assert body == {"configured": False, "connected": False, "scope": None, "connected_at": None}


async def test_authorize_requests_read_only_scope(client, auth, fake_strava):
    r = await client.post("/api/fitness/strava/authorize",
                          json={"redirect_uri": "http://localhost:5173/atlas/"}, headers=auth)
    scope = dict(httpx.URL(r.json()["url"]).params)["scope"]
    assert "write" not in scope
    assert "activity:read_all" in scope


async def test_authorize_refuses_foreign_redirects(client, auth, fake_strava):
    r = await client.post("/api/fitness/strava/authorize",
                          json={"redirect_uri": "https://evil.example/cb"}, headers=auth)
    assert r.status_code == 400


async def test_exchange_rejects_an_unknown_state(client, auth, fake_strava):
    """Without state binding, anyone could attach their Strava to this account."""
    r = await client.post("/api/fitness/strava/exchange",
                          json={"code": "c", "state": "atlas-strava:forged", "scope": "activity:read_all"},
                          headers=auth)
    assert r.status_code == 400


async def test_state_is_single_use(client, auth, fake_strava):
    r = await client.post("/api/fitness/strava/authorize",
                          json={"redirect_uri": "http://localhost:5173/atlas/"}, headers=auth)
    state = dict(httpx.URL(r.json()["url"]).params)["state"]
    body = {"code": "c", "state": state, "scope": "activity:read_all"}
    assert (await client.post("/api/fitness/strava/exchange", json=body, headers=auth)).status_code == 200
    assert (await client.post("/api/fitness/strava/exchange", json=body, headers=auth)).status_code == 400


async def test_exchange_refuses_when_activity_access_was_unticked(client, auth, fake_strava):
    r = await client.post("/api/fitness/strava/authorize",
                          json={"redirect_uri": "http://localhost:5173/atlas/"}, headers=auth)
    state = dict(httpx.URL(r.json()["url"]).params)["state"]
    r = await client.post("/api/fitness/strava/exchange",
                          json={"code": "c", "state": state, "scope": "read"}, headers=auth)
    assert r.status_code == 502 and "Activity access" in r.json()["detail"]


async def test_tokens_are_stored_encrypted(client, auth, fake_strava, monkeypatch):
    import importlib, crypto, strava_client
    monkeypatch.setenv("ATLAS_ENCRYPTION_KEY", "0123456789abcdef" * 4)
    importlib.reload(crypto)
    monkeypatch.setattr(strava_client, "enc", crypto.enc)
    monkeypatch.setattr(strava_client, "dec", crypto.dec)

    await _connect(client, auth)
    row = (await _raw("SELECT * FROM strava_connection"))[0]
    assert row["access_token"].startswith("enc:v1:") and "a1" not in row["access_token"]
    assert row["refresh_token"].startswith("enc:v1:")
    monkeypatch.delenv("ATLAS_ENCRYPTION_KEY")
    importlib.reload(crypto)


# ── Summary ───────────────────────────────────────────────────────────────────

async def test_summary_returns_weekly_volume(client, auth, fake_strava):
    await _connect(client, auth)
    body = (await client.get("/api/fitness/strava/summary?weeks=4", headers=auth)).json()
    assert len(body["weeks"]) == 4
    assert body["ytd"]["run"]["distance"] == 210000.0
    assert {r["sport"] for r in body["recent"]} <= {"run", "swim", "ride"}


async def test_strava_activities_are_never_written_to_the_database(client, auth, fake_strava):
    """Strava's policy forbids retaining their data beyond a transient cache."""
    await _connect(client, auth)
    await client.get("/api/fitness/strava/summary", headers=auth)

    import aiosqlite
    from database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        async with db.execute("SELECT name FROM sqlite_master WHERE type='table'") as cur:
            tables = [r[0] for r in await cur.fetchall()]
        for table in tables:
            async with db.execute(f"SELECT * FROM {table}") as cur:
                dump = json.dumps([list(r) for r in await cur.fetchall()], default=str)
            assert "activities/11" not in dump and '"Run"' not in dump, table
    strava_tables = [t for t in tables if "strava" in t]
    assert strava_tables == ["strava_connection"]


async def test_second_request_is_served_from_the_transient_cache(client, auth, fake_strava):
    await _connect(client, auth)
    await client.get("/api/fitness/strava/summary", headers=auth)
    before = fake_strava.calls.count("/api/v3/athlete/activities")
    await client.get("/api/fitness/strava/summary", headers=auth)
    assert fake_strava.calls.count("/api/v3/athlete/activities") == before


async def test_rate_limit_serves_stale_copy_flagged(client, auth, fake_strava, monkeypatch):
    import strava_client
    await _connect(client, auth)
    await client.get("/api/fitness/strava/summary", headers=auth)
    # Age the cache past the TTL but within the stale window, then hit a 429.
    for k, (t, v) in list(strava_client._cache.items()):
        strava_client._cache[k] = (t - strava_client.CACHE_TTL - 1, v)
    fake_strava.rate_limited = True
    body = (await client.get("/api/fitness/strava/summary", headers=auth)).json()
    assert body["stale"] is True and body["weeks"]


async def test_rate_limit_with_nothing_cached_is_a_503(client, auth, fake_strava):
    await _connect(client, auth)
    fake_strava.rate_limited = True
    r = await client.get("/api/fitness/strava/summary", headers=auth)
    assert r.status_code == 503 and r.json()["code"] == "rate_limited"


async def test_rotated_refresh_token_is_persisted(client, auth, fake_strava):
    """Strava invalidates the old refresh token immediately. Losing the new one
    means silently losing the connection at the next refresh."""
    await _connect(client, auth)
    fake_strava.refresh_tokens = {"r1"}
    import aiosqlite
    from database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("UPDATE strava_connection SET expires_at = 0")
        await db.commit()

    await client.get("/api/fitness/strava/summary", headers=auth)
    row = (await _raw("SELECT refresh_token, expires_at FROM strava_connection"))[0]
    assert row["refresh_token"] == "r-next"
    assert row["expires_at"] > time.time()


async def test_revocation_on_stravas_side_purges_the_connection(client, auth, fake_strava):
    await _connect(client, auth)
    await client.get("/api/fitness/strava/summary", headers=auth)
    fake_strava.revoked = True
    import strava_client
    strava_client.purge_cache()
    r = await client.get("/api/fitness/strava/summary", headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "revoked"
    assert await _raw("SELECT * FROM strava_connection") == []


async def test_disconnect_revokes_and_forgets_everything(client, auth, fake_strava):
    import strava_client
    await _connect(client, auth)
    await client.get("/api/fitness/strava/summary", headers=auth)
    assert strava_client._cache

    assert (await client.delete("/api/fitness/strava", headers=auth)).status_code == 200
    assert "/oauth/deauthorize" in fake_strava.calls
    assert await _raw("SELECT * FROM strava_connection") == []
    assert strava_client._cache == {}


async def test_summary_when_not_connected(client, auth, fake_strava):
    r = await client.get("/api/fitness/strava/summary", headers=auth)
    assert r.status_code == 409 and r.json()["code"] == "not_connected"


# ── The AI boundary ───────────────────────────────────────────────────────────

async def test_no_mcp_tool_exposes_strava_data(monkeypatch):
    """Strava's policy forbids use of their data in operating any AI application.
    The assistant is one, so nothing Strava-derived may be reachable over MCP —
    regardless of any env flag."""
    import inspect
    import mcp_server
    for flag in ("off", "redacted", "full"):
        monkeypatch.setattr(mcp_server, "MCP_TRANSACTIONS", flag)
        names = " ".join(t.name + " " + (t.description or "") for t in await mcp_server.list_tools()).lower()
        for word in ("strava", "activit", "fitness", "workout", "exercise"):
            assert word not in names, word
    source = inspect.getsource(mcp_server)
    assert "strava" not in source.lower()
    assert "fitness_stats" not in source


# ── Gym log ───────────────────────────────────────────────────────────────────

async def _gym(client, auth):
    return (await client.get("/api/fitness/gym", headers=auth)).json()["sections"]


async def test_sections_and_exercises_round_trip_in_order(client, auth):
    for i, name in enumerate(["Push", "Pull", "Legs"]):
        await client.post("/api/fitness/gym/sections", json={"id": f"s{i}", "name": name}, headers=auth)
    await client.post("/api/fitness/gym/sections/s0/exercises",
                      json={"id": "e1", "name": "Bench press", "weight": 70, "sets": 3, "reps": "8"}, headers=auth)
    await client.post("/api/fitness/gym/sections/s0/exercises",
                      json={"id": "e2", "name": "OHP", "weight": 40, "sets": 3, "reps": "8-10"}, headers=auth)
    sections = await _gym(client, auth)
    assert [s["name"] for s in sections] == ["Push", "Pull", "Legs"]
    assert [e["name"] for e in sections[0]["exercises"]] == ["Bench press", "OHP"]
    assert sections[0]["exercises"][1]["reps"] == "8-10"


async def test_weight_change_is_logged_once_per_day(client, auth):
    await client.post("/api/fitness/gym/sections", json={"id": "s", "name": "Push"}, headers=auth)
    await client.post("/api/fitness/gym/sections/s/exercises",
                      json={"id": "e", "name": "Bench", "weight": 70, "sets": 3, "reps": "8"}, headers=auth)
    for w in (72.5, 75, 72.5):        # fiddling at the rack
        await client.patch("/api/fitness/gym/exercises/e", json={"weight": w}, headers=auth)
    ex = (await _gym(client, auth))[0]["exercises"][0]
    assert ex["weight"] == 72.5
    assert len(ex["history"]) == 1 and ex["history"][0]["weight"] == 72.5


async def test_progression_across_days_is_kept(client, auth):
    await client.post("/api/fitness/gym/sections", json={"id": "s", "name": "Legs"}, headers=auth)
    await client.post("/api/fitness/gym/sections/s/exercises",
                      json={"id": "e", "name": "Squat", "weight": 100, "sets": 5, "reps": "5"}, headers=auth)
    import aiosqlite
    from database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("UPDATE gym_lift_log SET date = '2026-09-01'")
        await db.commit()
    await client.patch("/api/fitness/gym/exercises/e", json={"weight": 105}, headers=auth)
    hist = (await _gym(client, auth))[0]["exercises"][0]["history"]
    assert [h["weight"] for h in hist] == [100, 105]


async def test_rename_is_not_progression(client, auth):
    await client.post("/api/fitness/gym/sections", json={"id": "s", "name": "Pull"}, headers=auth)
    await client.post("/api/fitness/gym/sections/s/exercises",
                      json={"id": "e", "name": "Row", "weight": 60}, headers=auth)
    import aiosqlite
    from database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("UPDATE gym_lift_log SET date = '2026-09-01'")
        await db.commit()
    await client.patch("/api/fitness/gym/exercises/e", json={"name": "Barbell row"}, headers=auth)
    assert len((await _gym(client, auth))[0]["exercises"][0]["history"]) == 1


async def test_bodyweight_exercise_without_a_weight_is_allowed(client, auth):
    await client.post("/api/fitness/gym/sections", json={"id": "s", "name": "Pull"}, headers=auth)
    r = await client.post("/api/fitness/gym/sections/s/exercises",
                          json={"id": "e", "name": "Pull-ups", "sets": 3, "reps": "max"}, headers=auth)
    assert r.status_code == 200
    ex = (await _gym(client, auth))[0]["exercises"][0]
    assert ex["weight"] is None and ex["history"] == []


async def test_deleting_a_section_removes_its_exercises_and_history(client, auth):
    await client.post("/api/fitness/gym/sections", json={"id": "s", "name": "Push"}, headers=auth)
    await client.post("/api/fitness/gym/sections/s/exercises",
                      json={"id": "e", "name": "Bench", "weight": 70}, headers=auth)
    await client.delete("/api/fitness/gym/sections/s", headers=auth)
    assert await _gym(client, auth) == []
    assert await _raw("SELECT * FROM gym_exercises") == []
    assert await _raw("SELECT * FROM gym_lift_log") == []


async def test_adding_to_a_missing_section_is_a_404(client, auth):
    r = await client.post("/api/fitness/gym/sections/nope/exercises",
                          json={"id": "e", "name": "Bench"}, headers=auth)
    assert r.status_code == 404


@pytest.mark.parametrize("path", ["/api/fitness/gym", "/api/fitness/strava/status", "/api/fitness/strava/summary"])
async def test_fitness_routes_require_the_owner(client, path):
    assert (await client.get(path)).status_code == 401
