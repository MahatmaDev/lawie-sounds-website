<?php
require_once 'supabase-config.php';

echo "<h1>Supabase Connection Test</h1>";

if (testSupabaseConnection()) {
    echo "<p style='color:green'>✅ Connected to Supabase successfully!</p>";
    
    // Fetch and display services
    $result = supabaseRequest('services?select=name,price&order=display_order.asc', 'GET');
    
    if ($result['code'] === 200) {
        echo "<h2>Services in Database:</h2>";
        echo "<ul>";
        foreach ($result['data'] as $service) {
            echo "<li>" . $service['name'] . " - KES " . number_format($service['price']) . "</li>";
        }
        echo "</ul>";
    }
} else {
    echo "<p style='color:red'>❌ Connection failed. Check your credentials.</p>";
}
?>