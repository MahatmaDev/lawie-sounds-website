<?php 
// Include PHPMailer
require 'vendor/autoload.php';
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
$mail->SMTPDebug = 2;  // 2 for detailed debug output

// Process form submission
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Collect form inputs
    $name = $_POST['name'];
    $email = $_POST['email'];
    $phone = $_POST['phone'];
    $date = $_POST['event_date'];
    $event_type = $_POST['event_type'];
    $event_details = $_POST['event_details'];

    // Validation
    $nameErr = $emailErr = $phoneErr = $dateErr = $event_typeErr = $event_detailsErr = "";

    if (empty($name)) $nameErr = "Name is required";
    if (empty($email)) $emailErr = "Email is required";
    if (empty($phone)) $phoneErr = "Phone is required";
    if (empty($date)) $dateErr = "Event date is required";
    if (empty($event_type)) $event_typeErr = "Event type is required";
    if (empty($event_details)) $event_detailsErr = "Event details are required";

    // If no errors, send email
    if (empty($nameErr) && empty($emailErr) && empty($phoneErr) && empty($dateErr) && empty($event_typeErr) && empty($event_detailsErr)) {
        $mail = new PHPMailer(true);

        try {
            // Server settings
            $mail->isSMTP();
            $mail->Host = 'smtp.gmail.com';
            $mail->SMTPAuth = true;
            $mail->Username = 'ndegwak6@gmail.com';
            $mail->Password = 'gpvh huny rxjv uqch'; // Use App Password
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = 465;

            // 1. Send to Organizer
            $mail->setFrom('ndegwak6@gmail.com', 'Mahatma Event Services');
            $mail->addAddress('ndegwak6@gmail.com');

            $mail->isHTML(true);
            $mail->Subject = 'New Event Booking Request';
            $mail->Body    = "Name: $name<br>Email: $email<br>Phone: $phone<br>Event Date: $date<br>Event Type: $event_type<br>Event Details: $event_details";

            $mail->send();

            // 2. Send Confirmation to Customer
            $mail->clearAddresses();
            $mail->addAddress($email);

            $mail->Subject = "🎉 Thanks for Booking with Mahatma Event Services!";
            $mail->Body = "
                <h2>Hi $name,</h2>
                <p>Thank you for choosing <strong>Mahatma Event Services</strong> for your upcoming <strong>$event_type</strong> on <strong>$date</strong>.</p>
                <p>We’ve received your request and our team will get in touch with you shortly to confirm all the details.</p>
                <p>If you have any urgent questions, feel free to reply to this email.</p>
                <br>
                <p>Warm regards,<br><strong>Mahatma Event Services Team</strong></p>
                <p><em>Your trusted partner in making events unforgettable.</em></p>
            ";

            $mail->send();

            $confirmation_message = "✅ Welcome to Mahatma Event Services! Your booking request has been successfully received. A confirmation email has been sent to <strong>$email</strong>.";

            // Auto scroll & redirect
            echo "<script>
                document.addEventListener('DOMContentLoaded', function() {
                    const msg = document.querySelector('.confirmation-message');
                    if (msg) {
                        msg.scrollIntoView({ behavior: 'smooth' });
                    }
                });

                setTimeout(function() {
                    window.location.href = 'index.html';
                }, 5000);
            </script>";

        } catch (Exception $e) {
            $confirmation_message = "❌ Error submitting the form. Please try again later. Mailer Error: {$mail->ErrorInfo}";
        }
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Book Your Event</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css"/>
</head>
<body class="bg-gray-100 p-6">
    <div class="max-w-xl mx-auto bg-white shadow-lg p-8 rounded">
        <h2 class="text-2xl font-bold mb-4 text-center">Book Your Event</h2>

        <?php if (isset($confirmation_message)): ?>
            <div class="bg-green-100 text-green-800 p-4 rounded mb-4 animate__animated animate__fadeInDown confirmation-message">
                <?= $confirmation_message ?>
            </div>
        <?php endif; ?>

        <form method="post" action="booking.php" class="space-y-4">
            <div>
                <label>Name:</label>
                <input type="text" name="name" class="w-full border rounded p-2" required>
            </div>

            <div>
                <label>Email:</label>
                <input type="email" name="email" class="w-full border rounded p-2" required>
            </div>

            <div>
                <label>Phone:</label>
                <input type="text" name="phone" class="w-full border rounded p-2" required>
            </div>

            <div>
                <label>Event Date:</label>
                <input type="date" name="event_date" class="w-full border rounded p-2" required>
            </div>

            <div>
                <label>Event Type:</label>
                <select name="event_type" class="w-full border rounded p-2" required>
                    <option value="">-- Select --</option>
                    <option value="Wedding">Wedding</option>
                    <option value="Party">Party</option>
                    <option value="Corporate">Corporate Event</option>
                    <option value="Other">Other</option>
                </select>
            </div>

            <div>
                <label>Event Details:</label>
                <textarea name="event_details" class="w-full border rounded p-2" rows="4" required></textarea>
            </div>

            <button type="submit" class="bg-yellow-500 text-white px-6 py-2 rounded hover:bg-yellow-600 transition">Book Now</button>
        </form>
    </div>
</body>
</html>
