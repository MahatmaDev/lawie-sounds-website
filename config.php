<?php
// config.php - Database configuration
session_start();

// Database connection
define('DB_HOST', 'localhost');
define('DB_USER', 'root');     // Change for production
define('DB_PASS', '');          // Change for production
define('DB_NAME', 'lawie_sounds');

// Email configuration (for production)
define('SMTP_HOST', 'smtp.gmail.com');
define('SMTP_PORT', 587);
define('SMTP_USER', 'Ndegwak6@gmail.com');
define('SMTP_PASS', 'your-app-password');
define('ADMIN_EMAIL', 'lawiesounds@gmail.com');

// WhatsApp number
define('WHATSAPP_NUMBER', '254703925826');

// CSRF Token
function generateCSRFToken() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verifyCSRFToken($token) {
    return isset($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

// Database connection function
function getDBConnection() {
    try {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
        if ($conn->connect_error) {
            throw new Exception("Connection failed: " . $conn->connect_error);
        }
        $conn->set_charset("utf8mb4");
        return $conn;
    } catch (Exception $e) {
        error_log("Database Error: " . $e->getMessage());
        return null;
    }
}

// Send WhatsApp message via API
function sendWhatsAppNotification($phone, $message) {
    $whatsapp_url = "https://wa.me/" . WHATSAPP_NUMBER . "?text=" . urlencode($message);
    // Log for now (in production, use WhatsApp Business API)
    error_log("WhatsApp URL: " . $whatsapp_url);
    return $whatsapp_url;
}

// Send email (using mail() for simplicity, upgrade to PHPMailer for production)
function sendEmailNotification($to, $subject, $message) {
    $headers = "MIME-Version: 1.0" . "\r\n";
    $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
    $headers .= "From: bookings@lawiesounds.com" . "\r\n";
    
    return mail($to, $subject, $message, $headers);
}

// Validate phone number (Kenyan format)
function validatePhone($phone) {
    // Remove any non-digit characters
    $phone = preg_replace('/[^0-9]/', '', $phone);
    // Check if it's a valid Kenyan number (07xx or 01xx or +254...)
    return preg_match('/^(07|01|2547|2541)[0-9]{8}$/', $phone);
}

// Rate limiting
function checkRateLimit($ip) {
    $conn = getDBConnection();
    if (!$conn) return true;
    
    $stmt = $conn->prepare("SELECT COUNT(*) as attempts FROM bookings WHERE user_ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)");
    $stmt->bind_param("s", $ip);
    $stmt->execute();
    $result = $stmt->get_result();
    $row = $result->fetch_assoc();
    $stmt->close();
    $conn->close();
    
    return $row['attempts'] < 5; // Max 5 submissions per hour
}
?>