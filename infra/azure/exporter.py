#!/usr/bin/env python3
"""Serve the last 48 hours of Cowrie activity as signed JSON.

Read-only. Groups Cowrie's JSON log by attacker IP, protocol and hour, and
serves it on GET /events. Every response carries X-Timestamp and
X-Signature = hex(Ed25519 signature of timestamp + "." + body). The private
key never leaves this host; the website checks the signature with the public
key, so it can reject anything forged, altered or older than a few minutes
without holding any secret.

Passwords that attackers try are never published, only usernames.
Runs on Cowrie's own Python environment, which already has `cryptography`.
"""

import glob
import json
import os
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG_GLOB = os.environ.get("COWRIE_LOG_GLOB", "/home/cowrie/cowrie/var/log/cowrie/cowrie.json*")
from cryptography.hazmat.primitives.serialization import load_pem_private_key

with open(os.environ.get("SENSOR_KEY_FILE", "/etc/breachscope/sensor.key"), "rb") as key_file:
    KEY = load_pem_private_key(key_file.read(), password=None)
WINDOW = timedelta(hours=48)
CACHE_SECONDS = 30
RATE_PER_MINUTE = 30

_cache = {"at": 0.0, "body": b""}
_cache_lock = threading.Lock()
_hits = defaultdict(list)
_hits_lock = threading.Lock()


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def summarise(now):
    """Group recent Cowrie events by (source IP, protocol, hour)."""
    cutoff = now - WINDOW
    protocol_of = {}
    groups = {}
    for path in sorted(glob.glob(LOG_GLOB)):
        try:
            handle = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with handle:
            for line in handle:
                try:
                    event = json.loads(line)
                    at = parse_time(event["timestamp"])
                except (ValueError, KeyError):
                    continue
                if at < cutoff:
                    continue
                kind = event.get("eventid", "")
                session = event.get("session")
                if kind == "cowrie.session.connect":
                    protocol_of[session] = event.get("protocol", "ssh")
                ip = event.get("src_ip")
                if not ip:
                    continue
                protocol = protocol_of.get(session, "ssh")
                hour = at.replace(minute=0, second=0, microsecond=0)
                key = (ip, protocol, hour.isoformat())
                group = groups.setdefault(
                    key,
                    {
                        "src_ip": ip,
                        "protocol": protocol,
                        "hour": hour.isoformat(),
                        "first_seen": at.isoformat(),
                        "last_seen": at.isoformat(),
                        "sessions": set(),
                        "login_attempts": 0,
                        "login_successes": 0,
                        "commands": 0,
                        "usernames": Counter(),
                    },
                )
                group["first_seen"] = min(group["first_seen"], at.isoformat())
                group["last_seen"] = max(group["last_seen"], at.isoformat())
                if session:
                    group["sessions"].add(session)
                if kind in ("cowrie.login.failed", "cowrie.login.success"):
                    group["login_attempts"] += 1
                    if kind == "cowrie.login.success":
                        group["login_successes"] += 1
                    if event.get("username"):
                        group["usernames"][str(event["username"])[:32]] += 1
                elif kind == "cowrie.command.input":
                    group["commands"] += 1
    out = []
    for group in groups.values():
        group["sessions"] = len(group["sessions"])
        group["top_usernames"] = [name for name, _ in group.pop("usernames").most_common(3)]
        out.append(group)
    out.sort(key=lambda g: g["last_seen"], reverse=True)
    return out[:2000]


def body_now():
    with _cache_lock:
        if time.monotonic() - _cache["at"] < CACHE_SECONDS and _cache["body"]:
            return _cache["body"]
        now = datetime.now(timezone.utc)
        payload = {
            "generated_at": now.isoformat(),
            "sensor": {"name": "sensor-eus1", "region": "Azure East US"},
            "groups": summarise(now),
        }
        _cache["body"] = json.dumps(payload, separators=(",", ":")).encode()
        _cache["at"] = time.monotonic()
        return _cache["body"]


def allowed(ip):
    now = time.monotonic()
    with _hits_lock:
        recent = [t for t in _hits[ip] if now - t < 60]
        recent.append(now)
        _hits[ip] = recent
        return len(recent) <= RATE_PER_MINUTE


class Handler(BaseHTTPRequestHandler):
    server_version = "sensor-exporter"
    sys_version = ""

    def do_GET(self):
        if self.path != "/events":
            self.send_error(404)
            return
        if not allowed(self.client_address[0]):
            self.send_error(429)
            return
        body = body_now()
        stamp = str(int(time.time()))
        signature = KEY.sign(stamp.encode() + b"." + body).hex()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Timestamp", stamp)
        self.send_header("X-Signature", signature)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8443), Handler).serve_forever()
