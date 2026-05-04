<?php
// supabase-config.php

define('SUPABASE_URL', 'https://hwztlypkzbxmggldfdhc.supabase.co');
define('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3enRseXBremJ4bWdnbGRmZGhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjAwNzYsImV4cCI6MjA5MzAzNjA3Nn0.oVHxpDtXUf45GGQiV8cO19tUHeNNBWA4aEEivpku18w');
define('SUPABASE_SERVICE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3enRseXBremJ4bWdnbGRmZGhjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzQ2MDA3NiwiZXhwIjoyMDkzMDM2MDc2fQ.wzS5V6HUiW8XdOvK-15voRAeLfF3HfUQVHMF_pC9G70'); // Keep secret!

// Helper function to make Supabase API calls
function supabaseRequest($endpoint, $method = 'GET', $data = null, $useServiceKey = false) {
    $url = SUPABASE_URL . '/rest/v1/' . $endpoint;
    
    $headers = [
        'apikey: ' . ($useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY),
        'Authorization: Bearer ' . ($useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY),
        'Content-Type: application/json',
        'Prefer: return=representation'
    ];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    
    if ($method == 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    } elseif ($method == 'PUT') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    } elseif ($method == 'DELETE') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
    }
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return ['data' => json_decode($response, true), 'code' => $httpCode];
}

// Test connection
function testSupabaseConnection() {
    $result = supabaseRequest('services?limit=1', 'GET');
    return $result['code'] === 200;
}
?>