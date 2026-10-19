import json
import os
import time
from urllib.parse import parse_qs, urlparse

import psycopg
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from agent_admin import db, get_agent, get_business_context, install_routes, password_digest

ORIGIN = {"Origin": "http://127.0.0.1:5175"}
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql://bluecollar:bluecollar_dev@127.0.0.1:5437/bluecollaragents_test",
)


def reset_test_database(monkeypatch):
    if not TEST_DATABASE_URL.rsplit("/", 1)[-1].startswith("bluecollaragents_test"):
        raise RuntimeError("Refusing to reset a database without the bluecollaragents_test name")
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    with psycopg.connect(TEST_DATABASE_URL, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")


@pytest.fixture
def client(monkeypatch):
    reset_test_database(monkeypatch)
    monkeypatch.setenv("ADMIN_COOKIE_SECURE", "false")
    monkeypatch.setenv("ADMIN_ORIGINS", "http://127.0.0.1:5175")
    app = FastAPI()
    install_routes(app)
    with db() as c:
        salt = "ab" * 16
        c.execute(
            "INSERT INTO admin VALUES (?,?,?)",
            ("operator", salt, password_digest("testing-password-only", salt)),
        )
    with TestClient(app) as c:
        yield c


def login(client):
    response = client.post(
        "/api/admin/login",
        headers=ORIGIN,
        json={"username": "operator", "password": "testing-password-only"},
    )
    assert response.status_code == 200
    assert "httponly" in response.headers["set-cookie"].lower()
    return {**ORIGIN, "X-CSRF-Token": response.json()["csrf"]}


def test_catalog_hides_scripts(client):
    response = client.get("/api/agents")
    assert len(response.json()) == 4
    assert all(set(a) == {"id", "name", "description"} for a in response.json())
    assert client.get("/api/admin/agents").status_code == 401


def test_scheduling_uses_nearest_upcoming_date(client):
    scheduling = get_agent("scheduling")
    assert scheduling["version"] == 3
    assert "ask which year" in scheduling["prompt"]
    assert "nearest sensible upcoming date" in scheduling["prompt"]


def test_first_admin_can_be_created_once(monkeypatch):
    reset_test_database(monkeypatch)
    monkeypatch.setenv("ADMIN_COOKIE_SECURE", "false")
    monkeypatch.setenv("ADMIN_ORIGINS", "http://127.0.0.1:5175")
    monkeypatch.setenv("ADMIN_SETUP_TOKEN", "one-time-test-token")
    app = FastAPI()
    install_routes(app)
    with TestClient(app) as setup_client:
        assert setup_client.get("/api/admin/status").json() == {
            "needs_setup": True,
            "setup_available": True,
        }
        too_short = setup_client.post(
            "/api/admin/setup",
            headers=ORIGIN,
            json={
                "username": "owner",
                "password": "seven77",
                "setup_token": "one-time-test-token",
            },
        )
        assert too_short.status_code == 422
        bad = setup_client.post(
            "/api/admin/setup",
            headers=ORIGIN,
            json={"username": "owner", "password": "eight888", "setup_token": "bad"},
        )
        assert bad.status_code == 403
        created = setup_client.post(
            "/api/admin/setup",
            headers=ORIGIN,
            json={
                "username": "owner",
                "password": "eight888",
                "setup_token": "one-time-test-token",
            },
        )
        assert created.status_code == 200
        assert setup_client.get("/api/admin/agents").status_code == 200
        assert setup_client.get("/api/admin/status").json()["needs_setup"] is False
        repeated = setup_client.post(
            "/api/admin/setup",
            headers=ORIGIN,
            json={
                "username": "second",
                "password": "eight888",
                "setup_token": "one-time-test-token",
            },
        )
        assert repeated.status_code == 409


def test_edit_requires_session_origin_and_csrf(client):
    agent = get_agent("support")
    agent.pop("id")
    assert client.put("/api/admin/agents/support", json=agent).status_code == 401
    headers = login(client)
    assert client.put("/api/admin/agents/support", json=agent, headers=ORIGIN).status_code == 403
    bad = {**headers, "Origin": "https://untrusted.example"}
    assert client.put("/api/admin/agents/support", json=agent, headers=bad).status_code == 403


def test_save_persists_and_stale_version_rejected(client):
    headers = login(client)
    original = get_agent("support")
    edit = {k: v for k, v in original.items() if k != "id"}
    edit.update(name="Service Support", enabled=False)
    saved = client.put("/api/admin/agents/support", json=edit, headers=headers)
    assert saved.status_code == 200
    assert saved.json()["version"] == original["version"] + 1
    assert get_agent("support")["name"] == "Service Support"
    assert "support" not in [a["id"] for a in client.get("/api/agents").json()]
    assert client.put("/api/admin/agents/support", json=edit, headers=headers).status_code == 409
    with db() as c:
        previous = json.loads(c.execute("SELECT data FROM revisions").fetchone()["data"])
    assert previous == original


def test_logout_and_expiry(client):
    headers = login(client)
    assert client.post("/api/admin/logout", headers=headers).status_code == 200
    assert client.get("/api/admin/session").status_code == 401
    login(client)
    with db() as c:
        c.execute("UPDATE sessions SET expires=?", (time.time() - 1,))
        assert c.execute("SELECT MAX(expires) AS expiry FROM sessions").fetchone()[
            "expiry"
        ] < time.time()
    assert client.get("/api/admin/agents").status_code == 401


def test_login_throttle_and_origin(client):
    payload = {"username": "operator", "password": "wrong"}
    assert client.post("/api/admin/login", json=payload).status_code == 403
    for _ in range(10):
        assert client.post("/api/admin/login", json=payload, headers=ORIGIN).status_code == 401
    assert client.post("/api/admin/login", json=payload, headers=ORIGIN).status_code == 429


def test_scripts_are_distinct_and_role_based(client):
    agents = [get_agent(a["id"]) for a in client.get("/api/agents").json()]
    assert len({a["prompt"] for a in agents}) == 4
    assert all(
        "Emily" not in a["greeting"]
        and "demo" in a["greeting"].lower()
        and a["greeting"].endswith("Sound good?")
        for a in agents
    )


def test_call_history_requires_admin_and_records_transcripts(client):
    from call_history import finish_call, record_text, reserve_call, start_call

    call = reserve_call(get_agent("support"), "test-ip")
    assert start_call(call)
    assert not start_call(call)
    record_text(call, "caller", "I need to change an appointment.")
    record_text(call, "agent", "What date would you prefer?")
    finish_call(call, "time_limit")
    finish_call(call, "disconnected")
    assert client.get("/api/admin/calls").status_code == 401
    assert client.get("/api/admin/calls/" + call).status_code == 401
    login(client)
    assert client.get("/api/admin/calls").json()[0]["reason"] == "time_limit"
    detail = client.get("/api/admin/calls/" + call).json()
    assert [m["role"] for m in detail["messages"]] == ["caller", "agent"]
    assert "client_key" not in detail


def test_business_import_is_admin_only_and_saved_for_calls(client, monkeypatch):
    import business_import

    unauthorized = client.post(
        "/api/admin/business/preview", json={"domain": "example.com"}
    )
    assert unauthorized.status_code == 401
    headers = login(client)
    preview = {
        "domain": "https://example.com/",
        "content": "Business:\n- Example Plumbing\nBusiness hours:\n- Monday–Friday: 8–5",
        "pages": ["https://example.com/"],
        "facts": {"services": ["Emergency plumbing"]},
    }
    monkeypatch.setattr(business_import, "scrape_business", lambda _domain: preview)
    response = client.post(
        "/api/admin/business/preview", headers=headers, json={"domain": "example.com"}
    )
    assert response.json() == preview
    saved = client.put(
        "/api/admin/business",
        headers=headers,
        json={
            "domain": preview["domain"],
            "content": preview["content"],
            "source": {"pages": preview["pages"], "facts": preview["facts"]},
        },
    )
    assert saved.status_code == 200
    assert get_business_context() == preview["content"]
    assert client.get("/api/admin/business").json()["profile"]["domain"] == preview["domain"]

    created = client.post(
        "/api/admin/demo-links",
        headers=headers,
        json={"label": "Example Plumbing", "agent_id": "scheduling", "minutes": 12},
    )
    assert created.status_code == 200
    token = parse_qs(urlparse(created.json()["url"]).query)["demo"][0]
    public = client.get(f"/api/demos/{token}")
    assert public.json()["agent"]["id"] == "scheduling"
    assert public.json()["remaining_minutes"] == 12
    links = client.get("/api/admin/demo-links").json()
    assert links[0]["allotted_seconds"] == 720


def test_business_import_rejects_private_networks():
    from business_import import normalize_url

    with pytest.raises(HTTPException) as error:
        normalize_url("http://127.0.0.1")
    assert error.value.status_code == 422


def test_limit_and_idle_deadlines():
    from call_history import CallDeadline

    timer = CallDeadline(0)
    timer.activity(880)
    assert timer.check(889) is None
    assert timer.check(890) == "time_limit"
    assert timer.closes_at == 900
    timer.activity(899)
    assert timer.check(899) == "time_limit"
    idle = CallDeadline(0)
    assert idle.check(89) is None
    assert idle.check(90) == "idle_timeout"
    assert idle.closes_at == 100


def test_one_active_and_cooldown_are_shared_across_agents(client, monkeypatch):
    from fastapi import HTTPException

    import call_history

    now = 1000
    monkeypatch.setattr(call_history.time, "time", lambda: now)
    call = call_history.reserve_call(get_agent("tow"), "same-ip")
    with pytest.raises(HTTPException) as error:
        call_history.reserve_call(get_agent("leads"), "same-ip")
    assert error.value.status_code == 429
    assert call_history.start_call(call)
    call_history.finish_call(call, "disconnected")
    now += 59
    with pytest.raises(HTTPException):
        call_history.reserve_call(get_agent("support"), "same-ip")
    now += 1
    assert call_history.reserve_call(get_agent("support"), "same-ip")


def test_pending_connection_expires(client, monkeypatch):
    import call_history

    now = 1000
    monkeypatch.setattr(call_history.time, "time", lambda: now)
    call = call_history.reserve_call(get_agent("tow"), "test-ip")
    now += 61
    assert not call_history.start_call(call)
    # Expired connection reservations do not leave an active lock forever.
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        call_history.reserve_call(get_agent("tow"), "test-ip")
    now += 61
    assert call_history.reserve_call(get_agent("tow"), "test-ip")
