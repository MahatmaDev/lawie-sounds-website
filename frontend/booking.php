<?php
require_once 'config.php';

$errors = [];
$success = false;
$booking_id = null;

// Generate CSRF token
$csrf_token = generateCSRFToken();

// Get services for dropdown
$services = [];
$conn = getDBConnection();
if ($conn) {
    $result = $conn->query("SELECT id, name, slug FROM services WHERE is_active = 1 ORDER BY display_order");
    while ($row = $result->fetch_assoc()) {
        $services[] = $row;
    }
    $conn->close();
}

// Handle form submission
if ($_SERVER["REQUEST_METHOD"] === "POST") {
    // CSRF validation
    if (!verifyCSRFToken($_POST['csrf_token'] ?? '')) {
        $errors[] = "Security validation failed. Please refresh the page and try again.";
    } else {
        // Sanitize and validate inputs
        $name = trim(htmlspecialchars($_POST['name'] ?? ''));
        $email = trim(filter_var($_POST['email'] ?? '', FILTER_SANITIZE_EMAIL));
        $phone = trim($_POST['phone'] ?? '');
        $event_date = $_POST['event_date'] ?? '';
        $event_type = $_POST['event_type'] ?? '';
        $guest_count = $_POST['guest_count'] ?? '';
        $budget = $_POST['budget'] ?? '';
        $venue = trim(htmlspecialchars($_POST['venue'] ?? ''));
        $services_selected = $_POST['services'] ?? [];
        $event_details = trim(htmlspecialchars($_POST['event_details'] ?? ''));
        $source = $_POST['source'] ?? '';
        
        // Validation
        if (empty($name)) $errors[] = "Please enter your name.";
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) $errors[] = "Please enter a valid email address.";
        if (empty($phone) || !validatePhone($phone)) $errors[] = "Please enter a valid Kenyan phone number (e.g., 0712345678).";
        if (empty($event_date)) $errors[] = "Please select your event date.";
        if (empty($event_type)) $errors[] = "Please select your event type.";
        
        // Rate limiting
        $user_ip = $_SERVER['REMOTE_ADDR'];
        if (!checkRateLimit($user_ip)) {
            $errors[] = "Too many submissions. Please try again later.";
        }
        
        // If no errors, save to database
        if (empty($errors)) {
            $conn = getDBConnection();
            if ($conn) {
                $services_json = json_encode($services_selected);
                $status = 'pending';
                $created_at = date('Y-m-d H:i:s');
                
                $stmt = $conn->prepare("
                    INSERT INTO bookings (name, email, phone, event_date, event_type, guest_count, budget, venue, services, event_details, source, status, user_ip, created_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ");
                
                $stmt->bind_param("sssssssssssss", 
                    $name, $email, $phone, $event_date, $event_type, 
                    $guest_count, $budget, $venue, $services_json, 
                    $event_details, $source, $status, $user_ip, $created_at
                );
                
                if ($stmt->execute()) {
                    $booking_id = $stmt->insert_id;
                    $success = true;
                    
                    // Send WhatsApp notification to admin
                    $services_list = implode(", ", $services_selected);
                    $whatsapp_message = "📅 *NEW BOOKING REQUEST* 📅%0A%0A" .
                        "*Name:* $name%0A" .
                        "*Email:* $email%0A" .
                        "*Phone:* $phone%0A" .
                        "*Event Date:* $event_date%0A" .
                        "*Event Type:* $event_type%0A" .
                        "*Guests:* $guest_count%0A" .
                        "*Budget:* $budget%0A" .
                        "*Venue:* $venue%0A" .
                        "*Services:* $services_list%0A" .
                        "*Details:* $event_details%0A%0A" .
                        "_Submitted from website_";
                    
                    $whatsapp_url = "https://wa.me/" . WHATSAPP_NUMBER . "?text=" . $whatsapp_message;
                    
                    // Send email confirmation to client
                    $email_subject = "Booking Confirmation - Lawie Sounds";
                    $email_message = "
                        <html>
                        <head><title>Booking Confirmation</title></head>
                        <body style='font-family: Arial, sans-serif;'>
                            <h2>Thank you for choosing Lawie Sounds!</h2>
                            <p>Dear <strong>$name</strong>,</p>
                            <p>We have received your booking request for a <strong>$event_type</strong> on <strong>$event_date</strong>.</p>
                            <p><strong>Booking Reference:</strong> #$booking_id</p>
                            <p>Our team will contact you within 2 hours to confirm availability and provide a custom quote.</p>
                            <hr>
                            <p>For immediate assistance, WhatsApp us: <a href='https://wa.me/" . WHATSAPP_NUMBER . "'>Click here</a></p>
                            <p>Best regards,<br><strong>Lawie Sounds Team</strong></p>
                        </body>
                        </html>
                    ";
                    
                    sendEmailNotification($email, $email_subject, $email_message);
                    
                    // Also send email to admin
                    sendEmailNotification(ADMIN_EMAIL, "New Booking #$booking_id", $email_message);
                    
                } else {
                    $errors[] = "Database error. Please try again.";
                }
                $stmt->close();
                $conn->close();
            } else {
                $errors[] = "Database connection error. Please try again.";
            }
        }
        
        // Regenerate CSRF token after submission
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        $csrf_token = $_SESSION['csrf_token'];
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Book Your Event | Lawie Sounds</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <style>
        * { font-family: 'Inter', sans-serif; }
        .form-input:focus {
            border-color: #eab308;
            outline: none;
            box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.2);
        }
        .service-checkbox:checked + .service-label {
            border-color: #eab308;
            background-color: #fef3c7;
        }
    </style>
</head>
<body class="bg-gray-100">

    <!-- Header -->
    <header class="bg-black text-white sticky top-0 z-40 shadow-lg">
        <div class="container mx-auto px-4 py-4">
            <div class="flex flex-wrap items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="IMAGES/LOGO/1.jpg" alt="Lawie Sounds" class="h-10 w-10 rounded-full object-cover border-2 border-yellow-400">
                    <h1 class="text-xl font-bold">LAWIE <span class="text-yellow-400">SOUNDS</span></h1>
                </div>
                <nav class="hidden md:flex gap-6 text-sm font-semibold">
                    <a href="index.html" class="hover:text-yellow-400 transition">Home</a>
                    <a href="services.html" class="hover:text-yellow-400 transition">Services</a>
                    <a href="gallery.html" class="hover:text-yellow-400 transition">Gallery</a>
                    <a href="booking.php" class="text-yellow-400 border-b-2 border-yellow-400 pb-1">Booking</a>
                </nav>
                <div class="flex items-center gap-3">
                    <a href="tel:+254703925826" class="bg-yellow-400 text-black px-4 py-2 rounded-full text-sm font-bold hover:bg-yellow-300 transition">
                        <i class="fas fa-phone-alt mr-1"></i>Call Us
                    </a>
                </div>
            </div>
        </div>
    </header>

    <!-- Booking Form -->
    <section class="py-12 px-4">
        <div class="container mx-auto max-w-4xl">
            <div class="text-center mb-8">
                <h1 class="text-3xl md:text-4xl font-bold mb-3">Book Your <span class="text-yellow-500">Event</span></h1>
                <p class="text-gray-600">Fill out the form below and we'll respond within <strong class="text-yellow-500">2 hours</strong></p>
            </div>

            <div class="bg-white rounded-2xl shadow-xl p-6 md:p-8">
                <?php if (!empty($errors)): ?>
                    <div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded">
                        <ul class="list-disc list-inside">
                            <?php foreach ($errors as $error): ?>
                                <li><?= htmlspecialchars($error) ?></li>
                            <?php endforeach; ?>
                        </ul>
                    </div>
                <?php endif; ?>

                <form method="POST" action="" id="bookingForm" class="space-y-6">
                    <input type="hidden" name="csrf_token" value="<?= $csrf_token ?>">
                    
                    <!-- Step 1: Contact Info -->
                    <div class="form-step active" data-step="1">
                        <h2 class="text-xl font-bold mb-4 flex items-center gap-2"><i class="fas fa-user text-yellow-500"></i> Your Contact Info</h2>
                        <div class="grid md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-semibold mb-1">Full Name *</label>
                                <input type="text" name="name" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" value="<?= htmlspecialchars($_POST['name'] ?? '') ?>" required>
                            </div>
                            <div>
                                <label class="block text-sm font-semibold mb-1">Phone Number *</label>
                                <input type="tel" name="phone" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" value="<?= htmlspecialchars($_POST['phone'] ?? '') ?>" required>
                            </div>
                        </div>
                        <div class="grid md:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label class="block text-sm font-semibold mb-1">Email Address *</label>
                                <input type="email" name="email" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" value="<?= htmlspecialchars($_POST['email'] ?? '') ?>" required>
                            </div>
                            <div>
                                <label class="block text-sm font-semibold mb-1">How did you hear about us?</label>
                                <select name="source" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition">
                                    <option value="">Select...</option>
                                    <option value="Instagram">Instagram</option>
                                    <option value="Facebook">Facebook</option>
                                    <option value="Google">Google Search</option>
                                    <option value="Friend">Friend/Family</option>
                                    <option value="Event">Previous Event</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Step 2: Event Details -->
                    <div class="form-step hidden" data-step="2">
                        <h2 class="text-xl font-bold mb-4 flex items-center gap-2"><i class="fas fa-calendar-alt text-yellow-500"></i> Event Details</h2>
                        <div class="grid md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-semibold mb-1">Event Date *</label>
                                <input type="date" name="event_date" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" value="<?= htmlspecialchars($_POST['event_date'] ?? '') ?>" required>
                            </div>
                            <div>
                                <label class="block text-sm font-semibold mb-1">Event Type *</label>
                                <select name="event_type" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" required>
                                    <option value="">Select...</option>
                                    <option value="Wedding" <?= ($_POST['event_type'] ?? '') == 'Wedding' ? 'selected' : '' ?>>Wedding</option>
                                    <option value="Birthday Party" <?= ($_POST['event_type'] ?? '') == 'Birthday Party' ? 'selected' : '' ?>>Birthday Party</option>
                                    <option value="Corporate Event" <?= ($_POST['event_type'] ?? '') == 'Corporate Event' ? 'selected' : '' ?>>Corporate Event</option>
                                    <option value="Concert" <?= ($_POST['event_type'] ?? '') == 'Concert' ? 'selected' : '' ?>>Concert</option>
                                    <option value="Graduation" <?= ($_POST['event_type'] ?? '') == 'Graduation' ? 'selected' : '' ?>>Graduation</option>
                                    <option value="Ruracio" <?= ($_POST['event_type'] ?? '') == 'Ruracio' ? 'selected' : '' ?>>Ruracio/Dowry</option>
                                </select>
                            </div>
                        </div>
                        <div class="grid md:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label class="block text-sm font-semibold mb-1">Expected Guest Count</label>
                                <select name="guest_count" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition">
                                    <option value="">Select range...</option>
                                    <option value="0-50">0-50 guests</option>
                                    <option value="51-100">51-100 guests</option>
                                    <option value="101-250">101-250 guests</option>
                                    <option value="251-500">251-500 guests</option>
                                    <option value="500+">500+ guests</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-semibold mb-1">Budget Range (KES)</label>
                                <select name="budget" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition">
                                    <option value="">Select budget...</option>
                                    <option value="10k-30k">KES 10,000 - 30,000</option>
                                    <option value="30k-50k">KES 30,000 - 50,000</option>
                                    <option value="50k-100k">KES 50,000 - 100,000</option>
                                    <option value="100k-200k">KES 100,000 - 200,000</option>
                                    <option value="200k+">KES 200,000+</option>
                                </select>
                            </div>
                        </div>
                        <div class="mt-4">
                            <label class="block text-sm font-semibold mb-1">Venue / Location *</label>
                            <input type="text" name="venue" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" value="<?= htmlspecialchars($_POST['venue'] ?? '') ?>" placeholder="e.g., Nairobi, KICC, Sarit Centre..." required>
                        </div>
                    </div>

                    <!-- Step 3: Services Selection -->
                    <div class="form-step hidden" data-step="3">
                        <h2 class="text-xl font-bold mb-4 flex items-center gap-2"><i class="fas fa-microphone-alt text-yellow-500"></i> Services Needed</h2>
                        <p class="text-sm text-gray-500 mb-4">Select all that apply</p>
                        <div class="grid md:grid-cols-2 gap-3">
                            <?php foreach ($services as $service): ?>
                                <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-yellow-50 transition">
                                    <input type="checkbox" name="services[]" value="<?= htmlspecialchars($service['name']) ?>" class="w-5 h-5 text-yellow-500 rounded focus:ring-yellow-400">
                                    <span class="ml-3"><?= htmlspecialchars($service['name']) ?></span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                        <div class="mt-4">
                            <label class="block text-sm font-semibold mb-1">Additional Notes / Special Requests</label>
                            <textarea name="event_details" rows="3" class="form-input w-full border border-gray-300 rounded-lg px-4 py-3 focus:border-yellow-400 transition" placeholder="Any specific requirements..."><?= htmlspecialchars($_POST['event_details'] ?? '') ?></textarea>
                        </div>
                    </div>

                    <!-- Step 4: Review -->
                    <div class="form-step hidden" data-step="4">
                        <h2 class="text-xl font-bold mb-4 flex items-center gap-2"><i class="fas fa-check-circle text-green-500"></i> Review & Submit</h2>
                        <div class="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                            <p><strong>Name:</strong> <span id="review_name"></span></p>
                            <p><strong>Email:</strong> <span id="review_email"></span></p>
                            <p><strong>Phone:</strong> <span id="review_phone"></span></p>
                            <p><strong>Event Date:</strong> <span id="review_date"></span></p>
                            <p><strong>Event Type:</strong> <span id="review_type"></span></p>
                            <p><strong>Venue:</strong> <span id="review_venue"></span></p>
                        </div>
                        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded mt-4">
                            <p class="text-sm"><i class="fas fa-clock mr-2"></i> We'll respond within <strong>2 hours</strong> via WhatsApp or email.</p>
                        </div>
                    </div>

                    <!-- Navigation Buttons -->
                    <div class="flex justify-between pt-4 border-t">
                        <button type="button" id="prevBtn" class="px-6 py-2 bg-gray-200 rounded-full font-semibold hover:bg-gray-300 transition hidden">← Back</button>
                        <button type="button" id="nextBtn" class="px-6 py-2 bg-yellow-400 rounded-full font-semibold hover:bg-yellow-500 transition ml-auto">Next →</button>
                        <button type="submit" id="submitBtn" class="px-6 py-2 bg-green-600 text-white rounded-full font-semibold hover:bg-green-700 transition hidden">Submit Booking</button>
                    </div>
                </form>
            </div>
        </div>
    </section>

    <!-- Footer -->
    <footer class="bg-gray-900 text-white mt-16">
        <div class="container mx-auto px-6 py-10 text-center">
            <p class="text-sm">&copy; 2025 <strong>LAWIE SOUNDS</strong></p>
        </div>
    </footer>

    <script>
        // Multi-step form handling
        let currentStep = 1;
        const totalSteps = 4;
        
        function updateStepDisplay() {
            document.querySelectorAll('.form-step').forEach(step => {
                step.classList.toggle('hidden', parseInt(step.dataset.step) !== currentStep);
            });
            
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');
            const submitBtn = document.getElementById('submitBtn');
            
            prevBtn.classList.toggle('hidden', currentStep === 1);
            
            if (currentStep === totalSteps) {
                nextBtn.classList.add('hidden');
                submitBtn.classList.remove('hidden');
                updateReview();
            } else {
                nextBtn.classList.remove('hidden');
                submitBtn.classList.add('hidden');
            }
        }
        
        function updateReview() {
            document.getElementById('review_name').innerText = document.querySelector('[name="name"]').value || '-';
            document.getElementById('review_email').innerText = document.querySelector('[name="email"]').value || '-';
            document.getElementById('review_phone').innerText = document.querySelector('[name="phone"]').value || '-';
            document.getElementById('review_date').innerText = document.querySelector('[name="event_date"]').value || '-';
            document.getElementById('review_type').innerText = document.querySelector('[name="event_type"]').value || '-';
            document.getElementById('review_venue').innerText = document.querySelector('[name="venue"]').value || '-';
        }
        
        document.getElementById('nextBtn').addEventListener('click', () => {
            // Basic validation for current step
            if (currentStep === 1) {
                const name = document.querySelector('[name="name"]').value;
                const email = document.querySelector('[name="email"]').value;
                const phone = document.querySelector('[name="phone"]').value;
                if (!name || !email || !phone) {
                    Swal.fire({ icon: 'warning', title: 'Missing Fields', text: 'Please fill in all required fields' });
                    return;
                }
            }
            if (currentStep === 2) {
                const eventDate = document.querySelector('[name="event_date"]').value;
                const eventType = document.querySelector('[name="event_type"]').value;
                const venue = document.querySelector('[name="venue"]').value;
                if (!eventDate || !eventType || !venue) {
                    Swal.fire({ icon: 'warning', title: 'Missing Fields', text: 'Please fill in all required fields' });
                    return;
                }
            }
            currentStep++;
            updateStepDisplay();
        });
        
        document.getElementById('prevBtn').addEventListener('click', () => {
            currentStep--;
            updateStepDisplay();
        });
        
        // Set minimum date to today
        const dateInput = document.querySelector('[name="event_date"]');
        if (dateInput) {
            const today = new Date().toISOString().split('T')[0];
            dateInput.min = today;
        }
        
        updateStepDisplay();
        
        <?php if ($success && $booking_id): ?>
            Swal.fire({
                icon: 'success',
                title: 'Booking Request Sent! 🎉',
                html: 'Thank you! Your booking reference is <strong>#<?= $booking_id ?></strong><br>We will contact you within 2 hours.',
                confirmButtonColor: '#eab308'
            }).then(() => {
                window.location.href = '<?= $whatsapp_url ?? "#" ?>';
            });
        <?php endif; ?>
    </script>
</body>
</html>