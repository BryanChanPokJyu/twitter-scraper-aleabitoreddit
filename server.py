#!/usr/bin/env python3
"""
Local dev server with Yahoo Finance proxy to bypass CORS.
Serves dashboard/ static files and proxies /api/yahoo/* requests.
"""

import http.server
import json
import os
import urllib.request
from urllib.parse import urlparse, parse_qs

PORT = 8899
DASHBOARD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dashboard')
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/yahoo/'):
            self.proxy_yahoo()
        elif self.path == '/' or self.path == '':
            self.send_response(302)
            self.send_header('Location', '/dashboard/')
            self.end_headers()
        else:
            super().do_GET()

    def proxy_yahoo(self):
        symbol_and_params = self.path[len('/api/yahoo/'):]
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol_and_params}'

        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        if '/api/yahoo/' in str(args[0]):
            print(f"  [proxy] {args[0]}")


if __name__ == '__main__':
    print(f"Dashboard: http://localhost:{PORT}/dashboard/")
    print(f"Yahoo proxy: http://localhost:{PORT}/api/yahoo/AAPL?period1=...&interval=1d")
    print()
    server = http.server.HTTPServer(('', PORT), Handler)
    server.serve_forever()
