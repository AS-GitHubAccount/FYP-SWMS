#!/bin/bash
# Backend on :3000, static files on :8080. Logs go to backend.log / frontend.log in the repo root.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

BACKEND_PID=""
FRONTEND_PID=""

if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Backend already up on port 3000."
else
    echo "Starting backend..."
    cd "$SCRIPT_DIR/backend" || exit 1
    if [ ! -d "node_modules" ]; then
        echo "Installing npm packages..."
        npm install
    fi
    npm start > "$SCRIPT_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo "Backend pid $BACKEND_PID — tail -f backend.log for output"
    sleep 3
fi

if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Something already on port 8080 (using that as static server)."
else
    echo "Starting static server on 8080..."
    cd "$SCRIPT_DIR" || exit 1
    if command_exists python3; then
        python3 -m http.server 8080 > "$SCRIPT_DIR/frontend.log" 2>&1 &
        FRONTEND_PID=$!
    elif command_exists python; then
        python -m SimpleHTTPServer 8080 > "$SCRIPT_DIR/frontend.log" 2>&1 &
        FRONTEND_PID=$!
    elif command_exists php; then
        php -S localhost:8080 > "$SCRIPT_DIR/frontend.log" 2>&1 &
        FRONTEND_PID=$!
    else
        echo "Need Python 3, Python 2, or PHP for a quick static server."
        echo "Or: npx http-server -p 8080"
        exit 1
    fi
    echo "Static server pid $FRONTEND_PID — tail -f frontend.log"
    sleep 2
fi

echo ""
echo "Backend:  http://localhost:3000"
echo "UI:       http://localhost:8080/prototypes/login.html"
echo "Index:    http://localhost:8080/prototypes/index.html (redirects to login)"
echo ""
if [ -z "$BACKEND_PID" ] && [ -z "$FRONTEND_PID" ]; then
    echo "Nothing new was started (ports were already in use). You’re good."
    exit 0
fi

echo "Ctrl+C stops only the processes this script started (see pids above)."

cleanup() {
    echo ""
    echo "Stopping..."
    [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
    exit 0
}
trap cleanup INT

[ -n "$BACKEND_PID" ] && wait "$BACKEND_PID"
[ -n "$FRONTEND_PID" ] && wait "$FRONTEND_PID"
