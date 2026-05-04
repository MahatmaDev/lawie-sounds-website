// services-data.js - Complete data for all 9 services
// This file is loaded by service-detail.html

const SERVICES_DATA = {
  // ==================== DJ & MC SERVICES ====================
  "dj-mc-services": {
    name: "DJ & MC Services",
    slug: "dj-mc-services",
    icon: "fa-headphones",
    shortDesc: "Professional DJ and Master of Ceremonies for high-energy events.",
    longDesc: "Elevate your event with our professional DJ & MC services! From wedding receptions, corporate events, to club gigs, we deliver vibrant, seamless entertainment that keeps your guests dancing all night long. Our experienced MCs ensure smooth transitions between speeches, cake cutting, and special moments.",
    mainImage: "IMAGES/DJ and MC Services/1.jpg",
    galleryImages: [
      "IMAGES/DJ and MC Services/1.jpg",
      "IMAGES/DJ and MC Services/2.jpg",
      "IMAGES/DJ and MC Services/3.jpg",
      "IMAGES/DJ and MC Services/4.jpg",
      "IMAGES/DJ and MC Services/5.jpg",
      "IMAGES/DJ and MC Services/6.jpg"
    ],
    packages: [
      { name: "Basic DJ", price: 25000, duration: "Up to 4 hours", features: ["Professional DJ", "Sound system", "Basic lighting", "100+ song playlist"], popular: false },
      { name: "DJ + MC Combo", price: 45000, duration: "Up to 6 hours", features: ["Professional DJ + MC", "Premium sound system", "Full lighting setup", "Unlimited requests", "Event coordination"], popular: true },
      { name: "Elite Full Day", price: 70000, duration: "Full day (8+ hours)", features: ["Everything in Premium", "Extra DJ/MC backup", "LED screen included", "Pre-event consultation", "15% off next booking"], popular: false }
    ],
    features: [
      { icon: "fa-headphones", title: "Professional DJ", desc: "High-energy sets, seamless transitions" },
      { icon: "fa-microphone-alt", title: "MC Services", desc: "Professional emcee to keep flow" },
      { icon: "fa-database", title: "Music Library", desc: "Access to thousands of songs" },
      { icon: "fa-headset", title: "Wireless Mics", desc: "Crystal clear audio for speeches" }
    ],
    faqs: [
      { q: "How long does the DJ/MC perform?", a: "Packages range from 4 hours (basic) to full day (8+ hours). We can also do hourly rates for smaller events." },
      { q: "Can we request specific songs?", a: "Absolutely! We send a playlist form before the event. We also take live requests (subject to appropriateness)." },
      { q: "Do you provide sound equipment?", a: "Yes! All packages include professional sound system, microphones, and speakers suitable for your venue size." },
      { q: "Do you travel outside Nairobi?", a: "Yes! We serve all of Kenya. Travel costs may apply for locations outside Nairobi (KES 3,000-10,000 depending on distance)." }
    ],
    testimonials: [
      { clientName: "Sarah & James", rating: 5, comment: "Lawie Sounds made our wedding unforgettable! The DJ kept everyone dancing all night and the MC was so professional.", eventType: "Wedding" },
      { clientName: "Tech Corp Kenya", rating: 5, comment: "Corporate event was a success thanks to Lawie Sounds. Professional setup, great music selection.", eventType: "Corporate" },
      { clientName: "Michael O.", rating: 5, comment: "Best birthday party ever! The DJ played all our requests and the energy was insane!", eventType: "Birthday" }
    ]
  },

  // ==================== LED SCREENS ====================
  "led-screens": {
    name: "LED Screens",
    slug: "led-screens",
    icon: "fa-tv",
    shortDesc: "High-resolution LED screens for stunning visuals and branding.",
    longDesc: "High-resolution LED screens for stunning visuals at your event. Perfect for branding, lyrics display, live feeds, and presentations. Indoor and outdoor options available with full technical support.",
    mainImage: "IMAGES/LED Screens/2.jpg",
    galleryImages: [
      "IMAGES/LED Screens/1.jpg", "IMAGES/LED Screens/2.jpg", "IMAGES/LED Screens/3.jpg",
      "IMAGES/LED Screens/4.jpg", "IMAGES/LED Screens/5.jpg", "IMAGES/LED Screens/6.jpg",
      "IMAGES/LED Screens/7.jpg", "IMAGES/LED Screens/8.jpg"
    ],
    packages: [
      { name: "Standard Screen", price: 15000, duration: "Per day", features: ["6ft x 4ft screen", "Basic content setup", "HD resolution", "Technical support"], popular: false },
      { name: "Premium Package", price: 30000, duration: "Per day", features: ["12ft x 8ft screen", "Custom content design", "4K resolution", "Dedicated technician", "Live feed capable"], popular: true },
      { name: "Wall Package", price: 60000, duration: "Per day", features: ["Custom size wall", "Multi-screen setup", "Video wall processing", "2 technicians", "Backup system"], popular: false }
    ],
    features: [
      { icon: "fa-desktop", title: "High Resolution", desc: "Crystal clear 4K displays" },
      { icon: "fa-chalkboard", title: "Custom Content", desc: "Branding, lyrics, live feeds" },
      { icon: "fa-tools", title: "Full Setup", desc: "Cables, mounting, technician" },
      { icon: "fa-sun", title: "Indoor/Outdoor", desc: "Works in any lighting condition" }
    ],
    faqs: [
      { q: "What sizes are available?", a: "From 6ft to 20ft wide. Contact us for your specific needs." },
      { q: "Can you play videos from a phone?", a: "Yes, we support HDMI, USB, and wireless casting." }
    ],
    testimonials: [
      { clientName: "Nairobi Tech Expo", rating: 5, comment: "The LED screens were massive and crystal clear. Perfect for our product launch!", eventType: "Corporate" }
    ]
  },

  // ==================== POWER & LIGHTING ====================
  "power-lighting": {
    name: "Power & Lighting",
    slug: "power-lighting",
    icon: "fa-lightbulb",
    shortDesc: "Professional lighting design and power distribution for any venue.",
    longDesc: "Professional lighting design and power distribution for any venue size. Create the perfect atmosphere with our comprehensive lighting solutions including LED par cans, moving heads, spotlights, and full generator backup.",
    mainImage: "IMAGES/Power & Lighting/1.jpg",
    galleryImages: [
      "IMAGES/Power & Lighting/1.jpg", "IMAGES/Power & Lighting/2.jpg",
      "IMAGES/Power & Lighting/3.jpg", "IMAGES/Power & Lighting/4.jpg"
    ],
    packages: [
      { name: "Basic Lighting", price: 18000, duration: "Per event", features: ["LED par cans (8)", "Basic color washing", "Dimmer control", "Standard power"], popular: false },
      { name: "Premium Lighting", price: 35000, duration: "Per event", features: ["Moving heads (4)", "LED par cans (12)", "Spotlights (2)", "Generator backup", "Lighting operator"], popular: true },
      { name: "Concert Package", price: 65000, duration: "Per event", features: ["Full concert rig", "Truss system", "Laser effects", "Certified electrician", "Pre-programmed show"], popular: false }
    ],
    features: [
      { icon: "fa-lightbulb", title: "LED Par Cans", desc: "Colorful ambient lighting" },
      { icon: "fa-sync-alt", title: "Moving Heads", desc: "Dynamic light shows" },
      { icon: "fa-bolt", title: "Generator Backup", desc: "No power interruptions" },
      { icon: "fa-shield-alt", title: "Certified Electrician", desc: "Safe professional setup" }
    ],
    faqs: [
      { q: "Do you provide generators?", a: "Yes, backup generators included for all events." },
      { q: "Can you do outdoor lighting?", a: "Absolutely! We specialize in outdoor events." }
    ],
    testimonials: [
      { clientName: "Nairobi Music Festival", rating: 5, comment: "The lighting design transformed our stage. Absolutely stunning work!", eventType: "Concert" }
    ]
  },

  // ==================== PYROTECHNICS ====================
  "pyrotechnics": {
    name: "Pyrotechnics",
    slug: "pyrotechnics",
    icon: "fa-fire",
    shortDesc: "Spectacular fire effects, confetti, and CO2 cannons.",
    longDesc: "Spectacular fire effects, confetti blasts, and CO2 cannons for dramatic moments. Perfect for grand entrances, cake cutting, and special performances. Safety certified operators with full insurance.",
    mainImage: "IMAGES/Pyrotechnics/1.jpg",
    galleryImages: ["IMAGES/Pyrotechnics/1.jpg"],
    packages: [
      { name: "Confetti Package", price: 25000, duration: "Per event", features: ["Confetti cannons (4)", "Colorful confetti", "Manual trigger", "Safety certified"], popular: false },
      { name: "CO2 Package", price: 35000, duration: "Per event", features: ["CO2 jets (4)", "Cryo fog effects", "DMX controlled", "Crowd engagement"], popular: true },
      { name: "Full Effects", price: 65000, duration: "Per event", features: ["CO2 + Confetti", "Sparkular machines", "Flame effects", "Choreographed show", "Safety crew"], popular: false }
    ],
    features: [
      { icon: "fa-fire", title: "CO2 Jets", desc: "Dramatic fog effects" },
      { icon: "fa-tint", title: "Confetti Cannons", desc: "Colorful celebration blasts" },
      { icon: "fa-star", title: "Sparkular Machines", desc: "Cold spark fireworks" },
      { icon: "fa-shield-alt", title: "Safety Certified", desc: "Licensed operators" }
    ],
    faqs: [
      { q: "Is pyrotechnics safe indoors?", a: "Yes, our cold spark machines are safe for indoor use." },
      { q: "Do you need special permits?", a: "We handle all necessary permits for your event." }
    ],
    testimonials: [
      { clientName: "James & Mary", rating: 5, comment: "The pyrotechnics display was breathtaking! Made our wedding grand entrance unforgettable.", eventType: "Wedding" }
    ]
  },

  // ==================== PHOTOGRAPHY ====================
  "photography": {
    name: "Photography",
    slug: "photography",
    icon: "fa-camera",
    shortDesc: "Professional photography for weddings and events.",
    longDesc: "Professional photography coverage for weddings, corporate events, and parties. Capture every special moment with our team of experienced photographers. High-resolution edited photos delivered within 7 days.",
    mainImage: "IMAGES/Photography/1.jpg",
    galleryImages: [
      "IMAGES/Photography/1.jpg", "IMAGES/Photography/2.jpg", "IMAGES/Photography/3.jpg",
      "IMAGES/Photography/4.jpg", "IMAGES/Photography/5.jpg", "IMAGES/Photography/6.jpg",
      "IMAGES/Photography/7.jpg", "IMAGES/Photography/8.jpg"
    ],
    packages: [
      { name: "Single Photographer", price: 20000, duration: "4 hours", features: ["1 photographer", "100+ edited photos", "Online gallery", "Print rights"], popular: false },
      { name: "Dual Photographer", price: 35000, duration: "6 hours", features: ["2 photographers", "250+ edited photos", "Online gallery", "USB drive", "Print rights"], popular: true },
      { name: "Full Coverage", price: 55000, duration: "10+ hours", features: ["2 photographers", "500+ edited photos", "Photo album", "All raw files", "Pre-wedding shoot"], popular: false }
    ],
    features: [
      { icon: "fa-camera-retro", title: "2 Photographers", desc: "Multiple angles captured" },
      { icon: "fa-edit", title: "Edited Photos", desc: "High-res professionally edited" },
      { icon: "fa-cloud-upload-alt", title: "Online Gallery", desc: "Easy sharing with guests" },
      { icon: "fa-tachometer-alt", title: "Fast Delivery", desc: "Photos in 7 days" }
    ],
    faqs: [
      { q: "How many photos do you deliver?", a: "300-500 edited photos for a standard event." },
      { q: "Do you do engagement shoots?", a: "Yes, engagement shoots available at KES 10,000." }
    ],
    testimonials: [
      { clientName: "Ann & Peter", rating: 5, comment: "The photos exceeded our expectations! They captured every special moment perfectly.", eventType: "Wedding" }
    ]
  },

  // ==================== LIVE STREAMING & MEDIA ====================
  "live-streaming": {
    name: "Live Streaming & Media",
    slug: "live-streaming",
    icon: "fa-video",
    shortDesc: "Broadcast your event live to remote audiences worldwide.",
    longDesc: "Broadcast your event live to remote audiences with professional streaming setup. Multi-camera production, live switching, and stream to YouTube, Facebook, or custom platform.",
    mainImage: "IMAGES/Live Streaming & Media/1.jpg",
    galleryImages: [
      "IMAGES/Live Streaming & Media/1.jpg", "IMAGES/Live Streaming & Media/2.jpg",
      "IMAGES/Live Streaming & Media/3.jpg", "IMAGES/Live Streaming & Media/4.jpg",
      "IMAGES/Live Streaming & Media/5.jpg"
    ],
    packages: [
      { name: "Single Camera", price: 30000, duration: "Per event", features: ["1 camera", "Basic switching", "Stream to 1 platform", "Recording archive"], popular: false },
      { name: "Multi-Camera", price: 55000, duration: "Per event", features: ["3 cameras", "Live switching", "Stream to 2 platforms", "Graphics overlays", "Recording archive"], popular: true },
      { name: "Full Production", price: 95000, duration: "Per event", features: ["5 cameras", "Full control room", "Stream to unlimited", "Custom graphics", "Remote guests", "Replay system"], popular: false }
    ],
    features: [
      { icon: "fa-video", title: "Multi-Camera", desc: "Professional camera setup" },
      { icon: "fa-sliders-h", title: "Live Switching", desc: "Seamless scene transitions" },
      { icon: "fa-youtube", title: "Stream Anywhere", desc: "YouTube, Facebook, Zoom" },
      { icon: "fa-hdd", title: "Recording Archive", desc: "Keep a permanent copy" }
    ],
    faqs: [
      { q: "What internet speed is needed?", a: "We bring our own 4G/5G backup connection." },
      { q: "Can remote guests participate?", a: "Yes, with live chat and Q&A features." }
    ],
    testimonials: [
      { clientName: "Global Church Conference", rating: 5, comment: "The live stream was flawless. Remote attendees felt like they were there!", eventType: "Conference" }
    ]
  },

  // ==================== 360 BOOTH ====================
  "360-booth": {
    name: "360 Booth",
    slug: "360-booth",
    icon: "fa-cube",
    shortDesc: "Immersive 360 photo and video experience for guests.",
    longDesc: "Capture every angle of your special moments with our 360 Booth service! Perfect for weddings, parties, and corporate events. Guests receive instant shareable videos via WhatsApp or QR code.",
    mainImage: "IMAGES/360 Booth/1.jpg",
    galleryImages: [
      "IMAGES/360 Booth/1.jpg", "IMAGES/360 Booth/2.jpg",
      "IMAGES/360 Booth/3.jpg", "IMAGES/360 Booth/4.jpg"
    ],
    packages: [
      { name: "Standard", price: 22000, duration: "4 hours", features: ["360 video capture", "Instant sharing", "Basic props", "Digital gallery"], popular: false },
      { name: "Premium", price: 35000, duration: "6 hours", features: ["360 video + photos", "Custom branding", "Premium props", "Social media booth", "On-site attendant"], popular: true },
      { name: "Ultimate", price: 55000, duration: "Full day", features: ["Everything in Premium", "Slow-motion effects", "Green screen", "Photo prints", "Highlight reel"], popular: false }
    ],
    features: [
      { icon: "fa-video", title: "360° Video", desc: "Immersive slow-motion videos" },
      { icon: "fa-share-alt", title: "Instant Sharing", desc: "Share via WhatsApp/QR" },
      { icon: "fa-palette", title: "Custom Branding", desc: "Add your event logo" },
      { icon: "fa-clock", title: "Flexible Duration", desc: "Hourly or full-day" }
    ],
    faqs: [
      { q: "How many guests per session?", a: "1-8 people per session. Unlimited sessions." },
      { q: "Do you provide props?", a: "Yes! Props, hats, glasses, and signs included." }
    ],
    testimonials: [
      { clientName: "Grace's Birthday", rating: 5, comment: "The 360 booth was the highlight of the party! Everyone loved making videos.", eventType: "Birthday" }
    ]
  },

  // ==================== DRONE SERVICES ====================
  "drone-services": {
    name: "Drone Services",
    slug: "drone-services",
    icon: "fa-drone",
    shortDesc: "Aerial cinematography for stunning establishing shots.",
    longDesc: "Capture stunning aerial footage with our professional drone services! Licensed pilots, 4K Ultra HD, and fully insured. Perfect for weddings, real estate, events, and inspections.",
    mainImage: "IMAGES/Drone/1.jpg",
    galleryImages: ["IMAGES/Drone/1.jpg", "IMAGES/Drone/2.jpg"],
    packages: [
      { name: "Aerial Photos", price: 20000, duration: "2 hours", features: ["50+ edited photos", "4K resolution", "Online gallery", "Licensed pilot"], popular: false },
      { name: "Photo + Video", price: 35000, duration: "4 hours", features: ["100+ photos + video", "Professional editing", "Drone + ground", "Music background", "Same-day preview"], popular: true },
      { name: "Commercial", price: 50000, duration: "Full day", features: ["Full property survey", "3D mapping", "Commercial rights", "48hr delivery", "Raw footage"], popular: false }
    ],
    features: [
      { icon: "fa-id-card", title: "Licensed Pilot", desc: "KCAA certified & insured" },
      { icon: "fa-video", title: "4K Ultra HD", desc: "Crystal clear footage" },
      { icon: "fa-shield-alt", title: "Full Insurance", desc: "Liability coverage" },
      { icon: "fa-edit", title: "Professional Editing", desc: "Color grading & music" }
    ],
    faqs: [
      { q: "Is drone flying legal at my venue?", a: "We handle all permits and clearances." },
      { q: "What if it rains?", a: "We reschedule at no extra cost or provide ground photography." }
    ],
    testimonials: [
      { clientName: "Palm Real Estate", rating: 5, comment: "The aerial shots of our property were stunning! Helped sell the listing quickly.", eventType: "Real Estate" }
    ]
  },

  // ==================== PUBLIC ADDRESS SYSTEMS ====================
  "public-address": {
    name: "Public Address Systems",
    slug: "public-address",
    icon: "fa-volume-up",
    shortDesc: "Crystal-clear audio for speeches and announcements.",
    longDesc: "Crystal-clear audio for speeches, announcements, and background music. Professional sound system with line array speakers, wireless microphones, and dedicated sound engineer.",
    mainImage: "IMAGES/Public Address Systems/1.jpg",
    galleryImages: [
      "IMAGES/Public Address Systems/1.jpg", "IMAGES/Public Address Systems/2.jpg",
      "IMAGES/Public Address Systems/3.jpg", "IMAGES/Public Address Systems/4.jpg",
      "IMAGES/Public Address Systems/5.jpg"
    ],
    packages: [
      { name: "Basic PA", price: 20000, duration: "Per event", features: ["2 speakers", "2 wireless mics", "Basic mixer", "Sound engineer"], popular: false },
      { name: "Premium PA", price: 35000, duration: "Per event", features: ["Line array (4)", "4 wireless mics", "Digital mixer", "Dedicated engineer", "Coverage up to 2000 pax"], popular: true },
      { name: "Large Event", price: 60000, duration: "Per event", features: ["Line array (8)", "6 wireless mics", "Full monitoring", "2 engineers", "Coverage up to 5000 pax"], popular: false }
    ],
    features: [
      { icon: "fa-volume-up", title: "Line Array", desc: "Professional sound system" },
      { icon: "fa-microphone", title: "Wireless Mics", desc: "4 wireless microphones" },
      { icon: "fa-user-cog", title: "Sound Engineer", desc: "Professional on-site" },
      { icon: "fa-users", title: "Large Coverage", desc: "Up to 5000 pax" }
    ],
    faqs: [
      { q: "Can you handle outdoor events?", a: "Yes, systems designed for indoor/outdoor." },
      { q: "Do you provide a sound check?", a: "Yes, we arrive early for full sound testing." }
    ],
    testimonials: [
      { clientName: "Nairobi City Council", rating: 5, comment: "The sound quality was excellent. Every word was heard clearly by thousands.", eventType: "Public Event" }
    ]
  }
};