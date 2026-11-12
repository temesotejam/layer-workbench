#!/usr/bin/env python3
"""Isolated localhost test server for Emscripten pthread browser checks.

Only intended for CI/local development, not public internet hosting.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

class IsolatedHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    if args.bind not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit("This development server must bind to localhost only.")
    with ThreadingHTTPServer((args.bind, args.port), IsolatedHandler) as server:
        print(f"Serving {Path.cwd()} at http://{args.bind}:{args.port}/", flush=True)
        server.serve_forever()

if __name__ == "__main__":
    main()
