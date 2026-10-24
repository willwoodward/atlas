import calendar_colors as cc


def test_default_rules():
    name = lambda t: cc.color_name_for(t, cc.DEFAULT_RULES)
    assert name("Work") == "sage"
    assert name("Team meeting") == "sage"
    assert name("Sleep") == "banana"
    assert name("Dentist") == "banana"
    assert name("Flight to Lisbon!") == "banana"
    assert name("Lunch") == "default"
    assert name("Dinner") == "default"
    assert name("Lunch with Sam") == "flamingo"
    assert name("Drinks") == "flamingo"
    assert name("Church") == "grape"
    assert name("Gym") == "blueberry"
    assert name("Parkrun") == "blueberry"
    assert name("Morning routine") == "lavender"
    assert cc.color_id_for("Lunch", cc.DEFAULT_RULES) is None
    assert cc.color_id_for("Gym", cc.DEFAULT_RULES) == "9"


def test_broken_pattern_is_skipped():
    cfg = {"rules": [{"pattern": "(", "color": "tomato"}, {"pattern": "x", "color": "basil"}], "fallback": "default"}
    assert cc.color_name_for("x", cfg) == "basil"


async def test_rules_route_round_trip(client, auth):
    got = (await client.get("/api/calendar/color-rules", headers=auth)).json()
    assert got["fallback"] == "lavender" and "flamingo" in got["choices"]
    new = {"rules": [{"label": "Climbing", "pattern": "boulder", "color": "tomato"}], "fallback": "default"}
    assert (await client.put("/api/calendar/color-rules", json=new, headers=auth)).status_code == 200
    got = (await client.get("/api/calendar/color-rules", headers=auth)).json()
    assert got["rules"] == new["rules"] and got["fallback"] == "default"
    bad = {"rules": [{"pattern": "x", "color": "pink"}], "fallback": "default"}
    assert (await client.put("/api/calendar/color-rules", json=bad, headers=auth)).status_code == 422
