#!/bin/bash
# Starts the API from backend/ (expects npm install already done).

cd "$(dirname "$0")/backend" || exit 1

if lsof -ti:3000 >/dev/null 2>&1; then
    echo "Something is already listening on port 3000."
    echo "Kill it with: lsof -ti:3000 | xargs kill -9"
    echo "Then run this script again or just: npm start"
    exit 1
fi

echo "Starting backend at http://localhost:3000 (Ctrl+C to stop)"
echo ""

npm start
