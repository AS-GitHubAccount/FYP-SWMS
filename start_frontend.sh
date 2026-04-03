#!/bin/bash
# Serves the repo root on port 8080 so /prototypes/... paths work.

cd "$(dirname "$0")" || exit 1

echo "Static site at http://localhost:8080"
echo "Login: http://localhost:8080/prototypes/login.html"
echo "Ctrl+C to stop."
echo ""

if command -v python3 &> /dev/null; then
    python3 -m http.server 8080
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer 8080
elif command -v php &> /dev/null; then
    php -S localhost:8080
else
    echo "No python or php on PATH. Install one, or run: npx http-server -p 8080"
    exit 1
fi
