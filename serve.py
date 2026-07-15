#!/usr/bin/env python3
"""No-cache static server for local game preview."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from datetime import date
import json
import os
from urllib.parse import urlparse

ROOT = os.path.join(os.path.dirname(__file__), "dist", "client")
PORT = 5173


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/init":
            self.send_json(
                {
                    "type": "init",
                    "postId": "local-preview",
                    "username": "local-diver",
                    "dateKey": date.today().isoformat(),
                    "dailySeed": 42,
                    "personalBest": 0,
                    "dailyBest": 0,
                    "streak": 0,
                    "todayPlayed": False,
                    "leaderboard": [],
                    "communityBlueprints": [],
                    "playersToday": 1,
                }
            )
            return
        if path == "/api/blueprints":
            self.send_json({"type": "blueprints", "blueprints": []})
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"status": "error", "message": "Invalid JSON"}, 400)
            return

        if path == "/api/score":
            depth = max(0, int(payload.get("depth", 0)))
            self.send_json(
                {
                    "type": "score",
                    "personalBest": depth,
                    "dailyBest": depth,
                    "streak": 1,
                    "isNewPersonalBest": True,
                    "isNewDailyBest": True,
                    "rank": 1,
                    "leaderboard": [
                        {"username": "local-diver", "depth": depth, "mode": payload.get("mode", "daily")}
                    ],
                }
            )
            return
        if path == "/api/blueprint":
            self.send_json(
                {
                    "type": "blueprint",
                    "id": "local-blueprint",
                    "message": "Saved for this preview session",
                }
            )
            return
        if path == "/api/vote":
            self.send_json({"type": "vote", "id": payload.get("id", "local"), "votes": 1})
            return
        self.send_json({"status": "error", "message": "Not found"}, 404)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Spiralfall → http://127.0.0.1:{PORT}/game.html", flush=True)
    httpd.serve_forever()
