"""Agent registry and single-operator admin sessions."""

import getpass
import hashlib
import hmac
import json
import os
import secrets
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from agent_seeds import seeds

COOKIE = "bca_admin"
VOICES = {
    "aura-2-luna-en",
    "aura-2-athena-en",
    "aura-2-thalia-en",
    "aura-2-orion-en",
    "aura-2-asteria-en",
    "flux-haley-en",
    "flux-paige-en",
}


@contextmanager
def db():
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection string")
    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(database_url, row_factory=dict_row)

    class PostgresConnection:
        def execute(self, sql, params=()):
            return conn.execute(sql.replace("?", "%s"), params)

        def executescript(self, script):
            for statement in script.split(";"):
                if statement.strip():
                    self.execute(statement)

    try:
        yield PostgresConnection()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(
          id TEXT, version INTEGER, data TEXT, saved DOUBLE PRECISION);
        CREATE TABLE IF NOT EXISTS admin(username TEXT PRIMARY KEY, salt TEXT, digest TEXT);
        CREATE TABLE IF NOT EXISTS sessions(
          token TEXT PRIMARY KEY, expires DOUBLE PRECISION, csrf TEXT);
        CREATE TABLE IF NOT EXISTS attempts(ip TEXT, at DOUBLE PRECISION);
        CREATE TABLE IF NOT EXISTS business_profile(
          id INTEGER PRIMARY KEY CHECK(id = 1), domain TEXT NOT NULL,
          content TEXT NOT NULL, source TEXT NOT NULL, updated DOUBLE PRECISION NOT NULL);
        CREATE TABLE IF NOT EXISTS demo_links(
          id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
          agent_id TEXT NOT NULL, business_content TEXT NOT NULL,
          allotted_seconds INTEGER NOT NULL, used_seconds INTEGER NOT NULL DEFAULT 0,
          active BOOLEAN NOT NULL DEFAULT TRUE, created DOUBLE PRECISION NOT NULL);
        ALTER TABLE revisions ALTER COLUMN saved TYPE DOUBLE PRECISION;
        ALTER TABLE sessions ALTER COLUMN expires TYPE DOUBLE PRECISION;
        ALTER TABLE attempts ALTER COLUMN at TYPE DOUBLE PRECISION;
        """)
        for agent in seeds():
            row = c.execute("SELECT data FROM agents WHERE id=?", (agent["id"],)).fetchone()
            if not row:
                c.execute("INSERT INTO agents VALUES (?,?)", (agent["id"], json.dumps(agent)))
                continue
            current = json.loads(row["data"])
            if current.get("version", 1) < agent["version"]:
                c.execute(
                    "INSERT INTO revisions VALUES (?,?,?,?)",
                    (agent["id"], current.get("version", 1), row["data"], time.time()),
                )
                c.execute(
                    "UPDATE agents SET data=? WHERE id=?", (json.dumps(agent), agent["id"])
                )


def list_agents():
    with db() as c:
        return [json.loads(r["data"]) for r in c.execute("SELECT data FROM agents ORDER BY id")]


def get_agent(agent_id):
    with db() as c:
        row = c.execute("SELECT data FROM agents WHERE id=?", (agent_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Agent not found")
    return json.loads(row["data"])


def get_business_context():
    with db() as c:
        row = c.execute("SELECT content FROM business_profile WHERE id=1").fetchone()
    return row["content"] if row else ""


def resolve_demo_link(token: str):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db() as c:
        row = c.execute(
            "SELECT id,label,agent_id,business_content,allotted_seconds,used_seconds,active "
            "FROM demo_links WHERE token_hash=?", (token_hash,)
        ).fetchone()
    if not row or not row["active"]:
        raise HTTPException(404, "Demo link not found or inactive")
    remaining = max(0, row["allotted_seconds"] - row["used_seconds"])
    if remaining <= 0:
        raise HTTPException(410, "This demo has used its allotted minutes")
    agent = get_agent(row["agent_id"])
    if not agent["enabled"]:
        raise HTTPException(404, "This demo category is unavailable")
    return {**dict(row), "remaining_seconds": remaining, "agent": agent}


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000).hex()


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class Setup(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=256)
    setup_token: str = Field(min_length=1, max_length=512)


class AgentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=240)
    greeting: str = Field(min_length=10, max_length=1000)
    prompt: str = Field(min_length=100, max_length=30000)
    voice: str
    enabled: bool
    version: int = Field(ge=1)


class BusinessImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(min_length=3, max_length=500)


class BusinessProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(min_length=3, max_length=500)
    content: str = Field(min_length=10, max_length=18000)
    source: dict = Field(default_factory=dict)


class DemoLinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=120)
    agent_id: str = Field(min_length=1, max_length=80)
    minutes: int = Field(ge=1, le=120)


def origin_check(request):
    allowed = os.getenv("ADMIN_ORIGINS", "http://127.0.0.1:5175,http://localhost:5175").split(",")
    if request.headers.get("origin") not in [item.strip() for item in allowed]:
        raise HTTPException(403, "Admin origin not allowed")


def authenticate(request, mutation=False):
    digest = hashlib.sha256(request.cookies.get(COOKIE, "").encode()).hexdigest()
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        session = c.execute("SELECT * FROM sessions WHERE token=?", (digest,)).fetchone()
    if not session:
        raise HTTPException(401, "Please sign in")
    if mutation:
        origin_check(request)
        if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf"]):
            raise HTTPException(403, "Invalid session verification")
    return session


def create_session(response):
    now = time.time()
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires < ?", (now,))
        c.execute(
            "INSERT INTO sessions VALUES (?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), now + 28800, csrf),
        )
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="strict",
        max_age=28800,
        secure=os.getenv("ADMIN_COOKIE_SECURE", "true") != "false",
        path="/api/admin",
    )
    return {"csrf": csrf}


def install_routes(app: FastAPI):
    initialize()
    from call_history import initialize_calls

    initialize_calls()

    @app.middleware("http")
    async def headers(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/agents")
    def public_agents():
        return [
            {k: a[k] for k in ("id", "name", "description")} for a in list_agents() if a["enabled"]
        ]

    @app.get("/api/demos/{token}")
    def public_demo(token: str):
        demo = resolve_demo_link(token)
        return {
            "label": demo["label"],
            "agent": {
                key: demo["agent"][key] for key in ("id", "name", "description")
            },
            "remaining_minutes": max(1, demo["remaining_seconds"] // 60),
        }

    @app.get("/api/admin/status")
    def admin_status():
        with db() as c:
            count = c.execute("SELECT COUNT(*) AS total FROM admin").fetchone()["total"]
        return {
            "needs_setup": count == 0,
            "setup_available": bool(os.getenv("ADMIN_SETUP_TOKEN")),
        }

    @app.post("/api/admin/setup")
    def setup(body: Setup, request: Request, response: Response):
        origin_check(request)
        expected = os.getenv("ADMIN_SETUP_TOKEN", "")
        if not expected or not hmac.compare_digest(body.setup_token, expected):
            raise HTTPException(403, "Invalid or unavailable setup token")
        salt = secrets.token_hex(16)
        with db() as c:
            c.execute("LOCK TABLE admin IN EXCLUSIVE MODE")
            if c.execute("SELECT COUNT(*) AS total FROM admin").fetchone()["total"]:
                raise HTTPException(409, "The admin account has already been created")
            c.execute(
                "INSERT INTO admin VALUES (?,?,?)",
                (body.username.strip(), salt, password_digest(body.password, salt)),
            )
        return create_session(response)

    @app.post("/api/admin/login")
    def login(body: Login, request: Request, response: Response):
        origin_check(request)
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        with db() as c:
            c.execute("DELETE FROM attempts WHERE at < ?", (now - 900,))
            count = c.execute(
                "SELECT COUNT(*) AS total FROM attempts WHERE ip=?", (ip,)
            ).fetchone()["total"]
            if count >= 10:
                raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
            c.execute("INSERT INTO attempts VALUES (?,?)", (ip, now))
            user = c.execute("SELECT * FROM admin WHERE username=?", (body.username,)).fetchone()
        digest = password_digest(body.password, user["salt"] if user else "00" * 16)
        if not user or not hmac.compare_digest(digest, user["digest"]):
            raise HTTPException(401, "Invalid username or password")
        with db() as c:
            c.execute("DELETE FROM attempts WHERE ip=?", (ip,))
        return create_session(response)

    @app.get("/api/admin/session")
    def session(request: Request):
        return {"csrf": authenticate(request)["csrf"]}

    @app.post("/api/admin/logout")
    def logout(request: Request, response: Response):
        session = authenticate(request, True)
        with db() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (session["token"],))
        response.delete_cookie(COOKIE, path="/api/admin")
        return {"ok": True}

    @app.get("/api/admin/agents")
    def admin_agents(request: Request):
        authenticate(request)
        return list_agents()

    @app.get("/api/admin/business")
    def business(request: Request):
        authenticate(request)
        with db() as c:
            row = c.execute(
                "SELECT domain,content,source,updated FROM business_profile WHERE id=1"
            ).fetchone()
        if not row:
            return {"profile": None}
        result = dict(row)
        result["source"] = json.loads(result["source"])
        return {"profile": result}

    @app.post("/api/admin/business/preview")
    def preview_business(body: BusinessImport, request: Request):
        authenticate(request, True)
        from business_import import scrape_business

        return scrape_business(body.domain)

    @app.put("/api/admin/business")
    def save_business(body: BusinessProfile, request: Request):
        authenticate(request, True)
        now = time.time()
        with db() as c:
            c.execute(
                "INSERT INTO business_profile(id,domain,content,source,updated) "
                "VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "domain=EXCLUDED.domain,content=EXCLUDED.content,"
                "source=EXCLUDED.source,updated=EXCLUDED.updated",
                (body.domain, body.content.strip(), json.dumps(body.source), now),
            )
        return {"domain": body.domain, "content": body.content.strip(), "updated": now}

    @app.post("/api/admin/demo-links")
    def create_demo_link(body: DemoLinkCreate, request: Request):
        authenticate(request, True)
        agent = get_agent(body.agent_id)
        if not agent["enabled"]:
            raise HTTPException(422, "Choose an enabled agent category")
        with db() as c:
            profile = c.execute("SELECT content FROM business_profile WHERE id=1").fetchone()
            if not profile:
                raise HTTPException(422, "Import and save the business website first")
            token = secrets.token_urlsafe(24)
            link_id = secrets.token_hex(16)
            c.execute(
                "INSERT INTO demo_links(id,token_hash,label,agent_id,business_content,"
                "allotted_seconds,used_seconds,active,created) "
                "VALUES (?,?,?,?,?,?,0,TRUE,?)",
                (
                    link_id,
                    hashlib.sha256(token.encode()).hexdigest(),
                    body.label.strip(),
                    body.agent_id,
                    profile["content"],
                    body.minutes * 60,
                    time.time(),
                ),
            )
        origin = request.headers.get("origin", "").rstrip("/")
        return {"id": link_id, "url": f"{origin}/?demo={token}", "minutes": body.minutes}

    @app.get("/api/admin/demo-links")
    def list_demo_links(request: Request):
        authenticate(request)
        with db() as c:
            rows = c.execute(
                "SELECT id,label,agent_id,allotted_seconds,used_seconds,active,created "
                "FROM demo_links ORDER BY created DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    @app.get("/api/admin/calls")
    def calls(request: Request, offset: int = 0):
        authenticate(request)
        with db() as c:
            rows = c.execute(
                "SELECT id,agent_name,version,created,started,ended,status,reason "
                "FROM calls ORDER BY created DESC LIMIT 50 OFFSET ?",
                (max(0, offset),),
            ).fetchall()
        return [dict(row) for row in rows]

    @app.get("/api/admin/calls/{call_id}")
    def transcript(call_id: str, request: Request):
        authenticate(request)
        with db() as c:
            row = c.execute(
                "SELECT id,agent_name,version,created,started,ended,status,reason "
                "FROM calls WHERE id=?",
                (call_id,),
            ).fetchone()
            if not row:
                raise HTTPException(404, "Call not found")
            messages = c.execute(
                "SELECT role,text,at FROM transcripts WHERE call_id=? ORDER BY sequence", (call_id,)
            ).fetchall()
        return {**dict(row), "messages": [dict(message) for message in messages]}

    @app.put("/api/admin/agents/{agent_id}")
    def update(agent_id: str, body: AgentEdit, request: Request):
        authenticate(request, True)
        if body.voice not in VOICES or not body.name.strip() or not body.prompt.strip():
            raise HTTPException(422, "Invalid voice or blank content")
        with db() as c:
            row = c.execute(
                "SELECT data FROM agents WHERE id=? FOR UPDATE", (agent_id,)
            ).fetchone()
            if not row:
                raise HTTPException(404, "Agent not found")
            old = json.loads(row["data"])
            if old["version"] != body.version:
                raise HTTPException(409, "A newer version exists. Reload before editing.")
            c.execute(
                "INSERT INTO revisions VALUES (?,?,?,?)",
                (agent_id, old["version"], row["data"], time.time()),
            )
            updated = {**body.model_dump(), "id": agent_id, "version": body.version + 1}
            c.execute("UPDATE agents SET data=? WHERE id=?", (json.dumps(updated), agent_id))
        return updated


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent / ".env")
    initialize()
    username = input("Admin username: ").strip()
    password = getpass.getpass("New password (at least 12 characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if not username or len(username) > 100 or not 12 <= len(password) <= 256:
        raise SystemExit("Use a username and a password of 12–256 characters.")
    if password != confirmation:
        raise SystemExit("Passwords did not match.")
    with db() as conn:
        conn.execute("DELETE FROM admin")
        salt = secrets.token_hex(16)
        conn.execute(
            "INSERT INTO admin VALUES (?,?,?)", (username, salt, password_digest(password, salt))
        )
        conn.execute("DELETE FROM sessions")
    print("Admin account saved; previous sessions have been signed out.")
