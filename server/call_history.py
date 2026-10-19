"""Durable call records and server-owned demo limits."""

import hashlib
import time
import uuid

from fastapi import HTTPException

from agent_admin import db

MAX_SECONDS = 900
IDLE_SECONDS = 90
CLOSING_SECONDS = 10
COOLDOWN_SECONDS = 60


def lock_calls(c):
    c.execute("LOCK TABLE calls IN SHARE ROW EXCLUSIVE MODE")


def initialize_calls():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS calls(
          id TEXT PRIMARY KEY, agent_id TEXT, agent_name TEXT, version INTEGER,
          client_key TEXT, created DOUBLE PRECISION, started DOUBLE PRECISION,
          ended DOUBLE PRECISION, status TEXT, reason TEXT, demo_id TEXT);
        CREATE TABLE IF NOT EXISTS transcripts(
          sequence BIGSERIAL PRIMARY KEY, call_id TEXT, role TEXT, text TEXT,
          at DOUBLE PRECISION);
        ALTER TABLE calls ALTER COLUMN created TYPE DOUBLE PRECISION;
        ALTER TABLE calls ALTER COLUMN started TYPE DOUBLE PRECISION;
        ALTER TABLE calls ALTER COLUMN ended TYPE DOUBLE PRECISION;
        ALTER TABLE calls ADD COLUMN IF NOT EXISTS demo_id TEXT;
        ALTER TABLE transcripts ALTER COLUMN at TYPE DOUBLE PRECISION;
        CREATE INDEX IF NOT EXISTS call_client ON calls(client_key, created);
        CREATE INDEX IF NOT EXISTS transcript_call ON transcripts(call_id, sequence);
        """)


def reserve_call(agent, ip, demo_id=None):
    now = time.time()
    key = hashlib.sha256(ip.encode()).hexdigest()
    with db() as c:
        lock_calls(c)
        c.execute(
            "UPDATE calls SET status='ended', reason='expired', ended=created+60 "
            "WHERE status='pending' AND created < ?",
            (now - 60,),
        )
        c.execute(
            "UPDATE calls SET status='ended', reason='server_interrupted', ended=started+? "
            "WHERE status='active' AND started < ?",
            (MAX_SECONDS, now - MAX_SECONDS - 15),
        )
    with db() as c:
        lock_calls(c)
        busy = c.execute(
            "SELECT id FROM calls WHERE client_key=? AND status IN ('pending','active')", (key,)
        ).fetchone()
        if busy:
            raise HTTPException(429, "A demo is already running. End it before starting another.")
        if demo_id and c.execute(
            "SELECT id FROM calls WHERE demo_id=? AND status IN ('pending','active')",
            (demo_id,),
        ).fetchone():
            raise HTTPException(429, "This company demo is already in use. Try again shortly.")
        recent = c.execute(
            "SELECT MAX(ended) AS latest FROM calls WHERE client_key=?", (key,)
        ).fetchone()["latest"]
        if recent and now - recent < COOLDOWN_SECONDS:
            raise HTTPException(429, "Please wait one minute between demos.")
        call_id = str(uuid.uuid4())
        c.execute(
            "INSERT INTO calls(id,agent_id,agent_name,version,client_key,created,started,"
            "ended,status,reason,demo_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                call_id,
                agent["id"],
                agent["name"],
                agent["version"],
                key,
                now,
                None,
                None,
                "pending",
                None,
                demo_id,
            ),
        )
    return call_id


def start_call(call_id):
    now = time.time()
    with db() as c:
        row = c.execute(
            "UPDATE calls SET status='active', started=? WHERE id=? "
            "AND status='pending' AND created >= ?",
            (now, call_id, now - 60),
        )
        return row.rowcount == 1


def finish_call(call_id, reason):
    now = time.time()
    with db() as c:
        row = c.execute(
            "UPDATE calls SET status='ended', reason=?, ended=? "
            "WHERE id=? AND status!='ended' RETURNING demo_id,started",
            (reason, now, call_id),
        ).fetchone()
        if row and row["demo_id"] and row["started"]:
            seconds = max(1, int(now - row["started"] + 0.999))
            c.execute(
                "UPDATE demo_links SET used_seconds=LEAST(allotted_seconds,used_seconds+?) "
                "WHERE id=?",
                (seconds, row["demo_id"]),
            )


def record_text(call_id, role, text):
    if not text.strip():
        return
    with db() as c:
        c.execute(
            "INSERT INTO transcripts(call_id,role,text,at) VALUES (?,?,?,?)",
            (call_id, role, text[:10000], time.time()),
        )


class CallDeadline:
    def __init__(self, now, max_seconds=MAX_SECONDS):
        self.started = self.last_activity = now
        self.max_seconds = max_seconds
        self.reason = None
        self.closes_at = None

    def activity(self, now):
        self.last_activity = now

    def check(self, now):
        if self.reason:
            return self.reason
        if now - self.started >= self.max_seconds - CLOSING_SECONDS:
            self.reason = "time_limit"
            self.closes_at = self.started + self.max_seconds
        elif now - self.last_activity >= IDLE_SECONDS:
            self.reason = "idle_timeout"
            self.closes_at = min(now + CLOSING_SECONDS, self.started + self.max_seconds)
        return self.reason
