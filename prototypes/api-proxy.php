<?php
/**
 * API Proxy - forwards requests to Node backend (port 3000)
 * Use when the page is served by XAMPP (port 80) but the Node API runs on port 3000.
 * 
 * Usage: fetch('/api-proxy.php?path=/alerts') instead of fetch('http://localhost:3000/api/alerts')
 */
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = isset($_GET['path']) ? $_GET['path'] : '/alerts';
$path = '/' . ltrim($path, '/');
$params = $_GET;
unset($params['path']);
$qs = http_build_query($params);
$url = 'http://127.0.0.1:3000/api' . $path . ($qs ? '?' . $qs : '');

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    isset($_SERVER['HTTP_AUTHORIZATION']) ? 'Authorization: ' . $_SERVER['HTTP_AUTHORIZATION'] : ''
]);

if ($_SERVER['REQUEST_METHOD'] === 'POST' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    $body = file_get_contents('php://input');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
}

$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($code ?: 500);
echo $resp ?: '{"success":false,"error":"Backend unreachable. Start Node: cd backend && node server.js"}';
