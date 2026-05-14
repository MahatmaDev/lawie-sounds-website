// ==================== ADMIN DASHBOARD CONTROLLER ====================
// API Configuration
const API_BASE_URL = 'http://localhost:5000/api/admin';
let currentTab = 'dashboard';
let currentEditId = null;

// ==================== AUTHENTICATION ====================
function checkAuth() {
  const isLoggedIn = localStorage.getItem('adminLoggedIn') === 'true';
  const loginOverlay = document.getElementById('loginOverlay');
  const dashboardContent = document.getElementById('dashboardContent');
  
  if (isLoggedIn) {
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (dashboardContent) dashboardContent.classList.remove('hidden');
    loadDashboard();
  } else {
    if (loginOverlay) loginOverlay.classList.remove('hidden');
    if (dashboardContent) dashboardContent.classList.add('hidden');
  }
}

// Login handler
document.getElementById('loginForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername')?.value || '';
  const password = document.getElementById('loginPassword')?.value || '';
  
  if (username === 'admin' && password === 'admin123') {
    localStorage.setItem('adminLoggedIn', 'true');
    checkAuth();
  } else {
    Swal.fire({ icon: 'error', title: 'Invalid credentials', text: 'Try admin / admin123', background: '#1e1e2a', color: '#fff' });
  }
});

// Logout handler
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  localStorage.removeItem('adminLoggedIn');
  checkAuth();
});

// ==================== MOCK DATA STORE ====================
let mockData = {
  events: [
    { id: '1', title: 'Afrobeat Night', date: '2025-05-15', venue: 'Club Volume, Nairobi', price: 1500, seatsLeft: 45, image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7', isActive: true },
    { id: '2', title: 'Corporate Gala', date: '2025-05-20', venue: 'KICC, Nairobi', price: 5000, seatsLeft: 120, image: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622', isActive: true }
  ],
  gallery: [],
  reviews: [
    { id: '1', clientName: 'Sarah & James', rating: 5, comment: 'Amazing service! Highly recommend.', eventType: 'Wedding', isApproved: true, createdAt: new Date().toISOString() },
    { id: '2', clientName: 'Tech Corp', rating: 5, comment: 'Professional and reliable.', eventType: 'Corporate', isApproved: false, createdAt: new Date().toISOString() }
  ],
  marketing: [
    { id: '1', type: 'banner', message: '🎉 Special Offer: 15% off April bookings!', ctaText: 'Claim Offer', ctaLink: '/booking.html', isActive: true, startDate: '2025-04-01', endDate: '2025-04-30' }
  ],
  bookings: [
    { id: '1', name: 'John Doe', email: 'john@example.com', phone: '0712345678', eventDate: '2025-06-01', eventType: 'Wedding', guestCount: '101-250', budget: '100k-200k', venue: 'Nairobi', status: 'pending', createdAt: new Date().toISOString() }
  ]
};

// Load persisted gallery from localStorage
function loadPersistedGallery() {
  const savedGallery = localStorage.getItem('lawie_gallery_items');
  if (savedGallery) {
    try {
      mockData.gallery = JSON.parse(savedGallery);
      console.log(`✅ Loaded ${mockData.gallery.length} gallery items from storage`);
    } catch(e) { console.error('Failed to load gallery', e); }
  }
}

// Save gallery to localStorage
function persistGallery() {
  localStorage.setItem('lawie_gallery_items', JSON.stringify(mockData.gallery));
  sessionStorage.setItem('lawie_gallery_items', JSON.stringify(mockData.gallery));
}

// ==================== LOAD DASHBOARD ====================
async function loadDashboard() {
  loadPersistedGallery();
  
  const statEvents = document.getElementById('statEvents');
  const statBookings = document.getElementById('statBookings');
  const statGallery = document.getElementById('statGallery');
  const statReviews = document.getElementById('statReviews');
  
  if (statEvents) statEvents.textContent = mockData.events.length;
  if (statBookings) statBookings.textContent = mockData.bookings.filter(b => b.status === 'pending').length;
  if (statGallery) statGallery.textContent = mockData.gallery.length;
  if (statReviews) statReviews.textContent = mockData.reviews.filter(r => !r.isApproved).length;
  
  renderDashboardContent();
}

function renderDashboardContent() {
  const container = document.getElementById('sectionContent');
  if (!container) return;
  
  const recentBookings = mockData.bookings.slice(0, 5);
  const pendingReviews = mockData.reviews.filter(r => !r.isApproved);
  
  container.innerHTML = `
    <div class="grid md:grid-cols-2 gap-6 mb-8">
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 class="font-semibold mb-4">📊 Monthly Bookings</h3>
        <canvas id="bookingsChart" height="200"></canvas>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h3 class="font-semibold mb-4">⚡ Quick Actions</h3>
        <div class="grid grid-cols-2 gap-3">
          <button onclick="switchTab('events')" class="p-3 bg-purple-600/20 rounded-xl text-purple-400 hover:bg-purple-600/30 transition">+ Add Event</button>
          <button onclick="switchTab('gallery')" class="p-3 bg-purple-600/20 rounded-xl text-purple-400 hover:bg-purple-600/30 transition">📸 Upload Image</button>
          <button onclick="switchTab('marketing')" class="p-3 bg-purple-600/20 rounded-xl text-purple-400 hover:bg-purple-600/30 transition">📢 Create Banner</button>
          <button onclick="switchTab('bookings')" class="p-3 bg-purple-600/20 rounded-xl text-purple-400 hover:bg-purple-600/30 transition">📋 View Bookings</button>
        </div>
      </div>
    </div>
    
    <div class="bg-gray-900 rounded-xl border border-gray-800 mb-6">
      <div class="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
        <h3 class="font-semibold">📋 Recent Bookings</h3>
        <button onclick="switchTab('bookings')" class="text-purple-400 text-sm hover:underline">View all →</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-800/50">
            <tr><th class="px-4 py-3 text-left text-xs">Name</th><th class="px-4 py-3 text-left text-xs">Event</th><th class="px-4 py-3 text-left text-xs">Date</th><th class="px-4 py-3 text-left text-xs">Status</th><th class="px-4 py-3 text-left text-xs">Actions</th></tr>
          </thead>
          <tbody>
            ${recentBookings.map(booking => `
              <tr class="table-row border-t border-gray-800">
                <td class="px-4 py-3">${escapeHtml(booking.name)}</td>
                <td class="px-4 py-3">${escapeHtml(booking.eventType)}</td>
                <td class="px-4 py-3">${new Date(booking.eventDate).toLocaleDateString()}</td>
                <td class="px-4 py-3"><span class="badge-${booking.status}">${booking.status}</span></td>
                <td class="px-4 py-3"><button onclick="viewBookingDetails('${booking.id}')" class="text-purple-400 hover:text-purple-300 text-sm">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    
    ${pendingReviews.length > 0 ? `
      <div class="bg-gray-900 rounded-xl border border-gray-800">
        <div class="px-6 py-4 border-b border-gray-800">
          <h3 class="font-semibold">⭐ Pending Reviews (${pendingReviews.length})</h3>
        </div>
        <div class="divide-y divide-gray-800">
          ${pendingReviews.map(review => `
            <div class="p-4 flex justify-between items-center">
              <div><p class="font-medium">${escapeHtml(review.clientName)}</p><p class="text-sm text-gray-400">${escapeHtml(review.comment)}</p></div>
              <div class="flex gap-2"><button onclick="approveReview('${review.id}')" class="px-3 py-1 bg-green-600 rounded-lg text-sm">Approve</button><button onclick="deleteReview('${review.id}')" class="px-3 py-1 bg-red-600 rounded-lg text-sm">Delete</button></div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
  
  const chartCanvas = document.getElementById('bookingsChart');
  if (chartCanvas && typeof Chart !== 'undefined') {
    new Chart(chartCanvas, {
      type: 'line',
      data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], datasets: [{ label: 'Bookings', data: [12, 19, 15, 27, 24], borderColor: '#7c4dff', tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { labels: { color: '#9ca3af' } } }, scales: { y: { ticks: { color: '#9ca3af' } }, x: { ticks: { color: '#9ca3af' } } } }
    });
  }
}

// ==================== HELPER FUNCTIONS ====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ==================== EVENTS MANAGEMENT ====================
function renderEvents() {
  const container = document.getElementById('sectionContent');
  if (!container) return;
  
  container.innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="openEventForm()" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition"><i class="fas fa-plus mr-2"></i>Add Event</button></div>
    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-800/50"><tr><th class="px-4 py-3 text-left">Title</th><th class="px-4 py-3 text-left">Date</th><th class="px-4 py-3 text-left">Venue</th><th class="px-4 py-3 text-left">Price</th><th class="px-4 py-3 text-left">Status</th><th class="px-4 py-3 text-left">Actions</th></tr></thead>
          <tbody>${mockData.events.map(event => `
            <tr class="table-row border-t border-gray-800"><td class="px-4 py-3">${escapeHtml(event.title)}</td><td class="px-4 py-3">${new Date(event.date).toLocaleDateString()}</td><td class="px-4 py-3">${escapeHtml(event.venue)}</td><td class="px-4 py-3">KES ${event.price.toLocaleString()}</td><td class="px-4 py-3"><span class="badge-${event.isActive ? 'active' : 'inactive'}">${event.isActive ? 'Active' : 'Inactive'}</span></td><td class="px-4 py-3"><button onclick="editEvent('${event.id}')" class="text-purple-400 mr-2">Edit</button><button onclick="deleteEvent('${event.id}')" class="text-red-400">Delete</button></td></tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
    <div class="mt-4 text-center text-gray-500 text-sm">${mockData.events.length} events total</div>
  `;
}

function openEventForm(id = null) {
  currentEditId = id;
  const event = id ? mockData.events.find(e => e.id === id) : null;
  document.getElementById('modalTitle').textContent = id ? 'Edit Event' : 'Add Event';
  document.getElementById('modalForm').innerHTML = `
    <div><label class="block text-sm mb-1">Title *</label><input type="text" id="eventTitle" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${escapeHtml(event?.title || '')}" required></div>
    <div><label class="block text-sm mb-1">Date *</label><input type="date" id="eventDate" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${event?.date || ''}" required></div>
    <div><label class="block text-sm mb-1">Venue *</label><input type="text" id="eventVenue" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${escapeHtml(event?.venue || '')}" required></div>
    <div><label class="block text-sm mb-1">Price (KES) *</label><input type="number" id="eventPrice" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${event?.price || ''}" required></div>
    <div><label class="block text-sm mb-1">Seats Left</label><input type="number" id="eventSeats" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${event?.seatsLeft || 100}"></div>
    <div><label class="block text-sm mb-1">Image URL</label><input type="url" id="eventImage" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${event?.image || ''}"></div>
    <div><label class="flex items-center gap-2"><input type="checkbox" id="eventActive" ${event?.isActive !== false ? 'checked' : ''}> <span class="text-sm">Active</span></label></div>
  `;
  document.getElementById('formModal').classList.remove('hidden');
}

async function saveEvent() {
  const newEvent = { 
    id: currentEditId || Date.now().toString(), 
    title: document.getElementById('eventTitle').value, 
    date: document.getElementById('eventDate').value, 
    venue: document.getElementById('eventVenue').value, 
    price: parseInt(document.getElementById('eventPrice').value), 
    seatsLeft: parseInt(document.getElementById('eventSeats').value), 
    image: document.getElementById('eventImage').value, 
    isActive: document.getElementById('eventActive').checked 
  };
  
  if (currentEditId) {
    mockData.events = mockData.events.map(e => e.id === currentEditId ? newEvent : e);
  } else {
    mockData.events.push(newEvent);
  }
  closeModal(); 
  renderEvents();
  Swal.fire({ icon: 'success', title: 'Saved!', timer: 1500, showConfirmButton: false, background: '#1e1e2a', color: '#fff' });
}

async function deleteEvent(id) {
  const result = await Swal.fire({ title: 'Delete event?', text: 'This action cannot be undone', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Delete', background: '#1e1e2a', color: '#fff' });
  if (result.isConfirmed) { 
    mockData.events = mockData.events.filter(e => e.id !== id); 
    renderEvents(); 
    Swal.fire({ icon: 'success', title: 'Deleted!', timer: 1500, showConfirmButton: false, background: '#1e1e2a', color: '#fff' }); 
  }
}

async function editEvent(id) {
  openEventForm(id);
}

// ==================== GALLERY MANAGEMENT (with Local File Upload) ====================
function renderGallery() {
  const container = document.getElementById('sectionContent');
  if (!container) return;
  
  if (!mockData.gallery || mockData.gallery.length === 0) {
    container.innerHTML = `
      <div class="flex justify-end mb-4"><button onclick="openGalleryForm()" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition"><i class="fas fa-upload mr-2"></i>Upload Image/Video</button></div>
      <div class="text-center text-gray-500 py-12">
        <i class="fas fa-image text-6xl mb-4 opacity-50"></i>
        <p class="text-lg">No images or videos yet.</p>
        <p class="text-sm mt-2">Click "Upload Image/Video" to add your first gallery item.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="flex justify-end mb-4"><button onclick="openGalleryForm()" class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition"><i class="fas fa-upload mr-2"></i>Upload Image/Video</button></div>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      ${mockData.gallery.map(img => `
        <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden hover:border-purple-500 transition group">
          <div class="relative h-40 bg-gray-800">
            ${img.type === 'video' ? 
              `<video src="${img.imageUrl}" class="w-full h-full object-cover"></video>` : 
              `<img src="${img.imageUrl}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\'w-full h-full flex items-center justify-center bg-gray-700\'><i class=\'fas fa-image text-4xl text-gray-500\'></i></div>'">`
            }
            <div class="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded group-hover:bg-purple-600 transition">${img.type === 'video' ? '🎬' : '📷'}</div>
          </div>
          <div class="p-3">
            <p class="text-sm font-medium truncate">${escapeHtml(img.title)}</p>
            <p class="text-xs text-gray-400">${escapeHtml(img.category)}</p>
            <button onclick="deleteImage('${img.id}')" class="mt-2 w-full bg-red-600/20 text-red-400 py-1 rounded-lg text-sm hover:bg-red-600/30 transition">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="mt-4 text-center text-gray-500 text-sm">${mockData.gallery.length} items in gallery</div>
  `;
}

function openGalleryForm() {
  currentEditId = null;
  document.getElementById('modalTitle').textContent = 'Add Gallery Item';
  document.getElementById('modalForm').innerHTML = `
    <div class="modal-header pb-3 border-b border-gray-700 mb-3">
      <p class="text-sm text-gray-400">📸 Upload Image or Video</p>
    </div>
    <div><label class="block text-sm mb-1">Title *</label><input type="text" id="galleryTitle" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" required></div>
    <div><label class="block text-sm mb-1">Category</label>
      <select id="galleryCategory" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
        <option>Weddings</option><option>Corporate</option><option>Equipment</option><option>Ruracio</option><option>Audio</option><option>Visual</option>
      </select>
    </div>
    <div><label class="block text-sm mb-1">Type</label>
      <select id="galleryType" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
        <option value="image">Image</option><option value="video">Video</option>
      </select>
    </div>
    <div><label class="block text-sm mb-1">Select File *</label>
      <input type="file" id="galleryFile" accept="image/*,video/*" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" required>
      <p class="text-xs text-gray-500 mt-1">Max file size: 50MB. Supported: JPG, PNG, GIF, MP4</p>
    </div>
    <div id="previewArea" class="hidden bg-gray-800/50 rounded-lg p-4 text-center">
      <p class="text-sm text-gray-400 mb-2">Preview:</p>
      <img id="imagePreview" class="mx-auto max-h-32 rounded-lg hidden">
      <video id="videoPreview" class="mx-auto max-h-32 rounded-lg hidden" controls></video>
    </div>
    <div id="uploadProgressArea" class="hidden">
      <div class="flex items-center gap-3">
        <div class="flex-1 bg-gray-700 rounded-full h-2"><div id="uploadProgressBar" class="bg-purple-600 h-2 rounded-full transition-all" style="width:0%"></div></div>
        <span id="uploadPercent" class="text-xs text-gray-400">0%</span>
      </div>
      <p id="uploadStatusMsg" class="text-xs text-gray-400 mt-2 text-center">Processing file...</p>
    </div>
  `;
  
  const typeSelect = document.getElementById('galleryType');
  const fileInput = document.getElementById('galleryFile');
  const previewArea = document.getElementById('previewArea');
  const imagePreview = document.getElementById('imagePreview');
  const videoPreview = document.getElementById('videoPreview');
  
  typeSelect?.addEventListener('change', () => {
    previewArea.classList.remove('hidden');
    imagePreview.classList.add('hidden');
    videoPreview.classList.add('hidden');
  });
  
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        Swal.fire({ icon: 'error', title: 'File Too Large', text: 'Maximum file size is 50MB', background: '#1e1e2a', color: '#fff' });
        fileInput.value = '';
        return;
      }
      const url = URL.createObjectURL(file);
      previewArea.classList.remove('hidden');
      if (typeSelect.value === 'image') {
        imagePreview.src = url;
        imagePreview.classList.remove('hidden');
        videoPreview.classList.add('hidden');
      } else {
        videoPreview.src = url;
        videoPreview.classList.remove('hidden');
        imagePreview.classList.add('hidden');
      }
    }
  });
  
  document.getElementById('formModal').classList.remove('hidden');
}

async function saveGallery() {
  const titleInput = document.getElementById('galleryTitle');
  const categorySelect = document.getElementById('galleryCategory');
  const typeSelect = document.getElementById('galleryType');
  const fileInput = document.getElementById('galleryFile');
  
  if (!titleInput.value.trim()) {
    Swal.fire({ icon: 'error', title: 'Missing Title', text: 'Please enter a title', background: '#1e1e2a', color: '#fff' });
    return;
  }
  
  if (!fileInput.files || !fileInput.files[0]) {
    Swal.fire({ icon: 'error', title: 'No File', text: 'Please select a file', background: '#1e1e2a', color: '#fff' });
    return;
  }
  
  const file = fileInput.files[0];
  const title = titleInput.value;
  const category = categorySelect.value;
  const type = typeSelect.value;
  
  const progressArea = document.getElementById('uploadProgressArea');
  const progressBar = document.getElementById('uploadProgressBar');
  const percentSpan = document.getElementById('uploadPercent');
  const statusMsg = document.getElementById('uploadStatusMsg');
  
  if (progressArea) progressArea.classList.remove('hidden');
  if (statusMsg) statusMsg.textContent = 'Converting image...';
  
  const reader = new FileReader();
  let progress = 0;
  const interval = setInterval(() => {
    if (progress < 90) {
      progress += 10;
      if (progressBar) progressBar.style.width = progress + '%';
      if (percentSpan) percentSpan.textContent = progress + '%';
    }
  }, 100);
  
  reader.onload = function(e) {
    const imageUrl = e.target.result;
    if (statusMsg) statusMsg.textContent = 'Saving to gallery...';
    if (progressBar) progressBar.style.width = '100%';
    if (percentSpan) percentSpan.textContent = '100%';
    
    const newItem = {
      id: Date.now().toString(),
      title: title,
      category: category,
      type: type,
      imageUrl: imageUrl,
      createdAt: new Date().toISOString()
    };
    
    mockData.gallery.unshift(newItem);
    persistGallery();
    
    closeModal();
    renderGallery();
    
    clearInterval(interval);
    if (progressArea) progressArea.classList.add('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (percentSpan) percentSpan.textContent = '0%';
    
    Swal.fire({
      icon: 'success',
      title: 'Upload Complete!',
      text: `${title} has been added to gallery`,
      timer: 2000,
      showConfirmButton: false,
      background: '#1e1e2a',
      color: '#fff'
    });
    
    titleInput.value = '';
    fileInput.value = '';
  };
  
  reader.onerror = function() {
    Swal.fire({ icon: 'error', title: 'Upload Failed', text: 'Could not read file', background: '#1e1e2a', color: '#fff' });
    if (progressArea) progressArea.classList.add('hidden');
    clearInterval(interval);
    if (progressBar) progressBar.style.width = '0%';
    if (percentSpan) percentSpan.textContent = '0%';
  };
  
  reader.readAsDataURL(file);
}

async function deleteImage(id) {
  const result = await Swal.fire({ title: 'Delete image?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Delete', background: '#1e1e2a', color: '#fff' });
  if (result.isConfirmed) { 
    mockData.gallery = mockData.gallery.filter(i => i.id !== id); 
    persistGallery();
    renderGallery(); 
  }
}

// ==================== REVIEWS MANAGEMENT ====================
function renderReviews() {
  const container = document.getElementById('sectionContent');
  if (!container) return;
  
  container.innerHTML = `
    <div class="space-y-3">
      ${mockData.reviews.map(review => `
        <div class="bg-gray-900 rounded-xl p-4 border ${review.isApproved ? 'border-gray-800' : 'border-yellow-500/30'}">
          <div class="flex justify-between items-start">
            <div>
              <div class="flex text-yellow-400 mb-1">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</div>
              <h3 class="font-semibold">${escapeHtml(review.clientName)}</h3>
              <p class="text-sm text-gray-400">${escapeHtml(review.eventType)} • ${new Date(review.createdAt).toLocaleDateString()}</p>
              <p class="mt-2">${escapeHtml(review.comment)}</p>
            </div>
            <div class="flex gap-2">
              ${!review.isApproved ? `<button onclick="approveReview('${review.id}')" class="px-3 py-1 bg-green-600 rounded-lg text-sm">Approve</button>` : ''}
              <button onclick="deleteReview('${review.id}')" class="px-3 py-1 bg-red-600 rounded-lg text-sm">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function approveReview(id) {
  mockData.reviews = mockData.reviews.map(r => r.id === id ? { ...r, isApproved: true } : r);
  renderReviews();
  Swal.fire({ icon: 'success', title: 'Review approved!', timer: 1500, showConfirmButton: false, background: '#1e1e2a', color: '#fff' });
}

async function deleteReview(id) {
  const result = await Swal.fire({ title: 'Delete review?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Delete', background: '#1e1e2a', color: '#fff' });
  if (result.isConfirmed) { 
    mockData.reviews = mockData.reviews.filter(r => r.id !== id); 
    renderReviews(); 
  }
}

// ==================== MARKETING MANAGEMENT ====================
function renderMarketing() {
  const container = document.getElementById('sectionContent');
  if (!container) return;
  
  container.innerHTML = `
    <div class="space-y-4">
      ${mockData.marketing.map(banner => `
        <div class="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div class="flex justify-between items-start">
            <div>
              <div class="flex items-center gap-2 mb-2">
                <span class="badge-${banner.isActive ? 'active' : 'inactive'}">${banner.isActive ? 'Active' : 'Inactive'}</span>
                <span class="text-xs text-gray-500">${banner.type}</span>
              </div>
              <p class="font-medium">${escapeHtml(banner.message)}</p>
              <p class="text-sm text-gray-400 mt-1">CTA: ${escapeHtml(banner.ctaText)} → ${escapeHtml(banner.ctaLink)}</p>
              <p class="text-xs text-gray-500 mt-2">${banner.startDate} to ${banner.endDate}</p>
            </div>
            <div class="flex gap-2">
              <button onclick="toggleBanner('${banner.id}')" class="px-3 py-1 bg-purple-600 rounded-lg text-sm">${banner.isActive ? 'Deactivate' : 'Activate'}</button>
              <button onclick="deleteBanner('${banner.id}')" class="px-3 py-1 bg-red-600 rounded-lg text-sm">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <button onclick="openMarketingForm()" class="mt-4 w-full bg-purple-600 hover:bg-purple-700 py-3 rounded-xl transition">+ Create New Banner</button>
  `;
}

function openMarketingForm() {
  document.getElementById('modalTitle').textContent = 'Create Marketing Banner';
  document.getElementById('modalForm').innerHTML = `
    <div><label class="block text-sm mb-1">Message *</label><textarea id="bannerMessage" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" rows="2" required placeholder="🎉 Special offer..."></textarea></div>
    <div><label class="block text-sm mb-1">CTA Text</label><input type="text" id="bannerCtaText" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="Learn More"></div>
    <div><label class="block text-sm mb-1">CTA Link</label><input type="text" id="bannerCtaLink" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="/booking.html"></div>
    <div><label class="block text-sm mb-1">Start Date</label><input type="date" id="bannerStartDate" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${new Date().toISOString().split('T')[0]}"></div>
    <div><label class="block text-sm mb-1">End Date</label><input type="date" id="bannerEndDate" class="w-full px-4 py-2 bg-gray-800 rounded-lg border border-gray-700" value="${new Date(Date.now() + 30*86400000).toISOString().split('T')[0]}"></div>
  `;
  document.getElementById('formModal').classList.remove('hidden');
}

async function saveMarketing() {
  mockData.marketing.push({ 
    id: Date.now().toString(), 
    type: 'banner', 
    message: document.getElementById('bannerMessage').value, 
    ctaText: document.getElementById('bannerCtaText').value, 
    ctaLink: document.getElementById('bannerCtaLink').value, 
    isActive: true, 
    startDate: document.getElementById('bannerStartDate').value, 
    endDate: document.getElementById('bannerEndDate').value 
  });
  closeModal(); 
  renderMarketing();
  Swal.fire({ icon: 'success', title: 'Banner created!', timer: 1500, showConfirmButton: false, background: '#1e1e2a', color: '#fff' });
}

function toggleBanner(id) {
  mockData.marketing = mockData.marketing.map(b => b.id === id ? { ...b, isActive: !b.isActive } : b);
  renderMarketing();
}

async function deleteBanner(id) {
  const result = await Swal.fire({ title: 'Delete banner?', icon: 'warning', showCancelButton: true, background: '#1e1e2a', color: '#fff' });
  if (result.isConfirmed) { 
    mockData.marketing = mockData.marketing.filter(b => b.id !== id); 
    renderMarketing(); 
  }
}

// ==================== BOOKINGS MANAGEMENT ====================
function renderBookings() {
  const container = document.getElementById('sectionContent');
  if (!container) return;
  
  container.innerHTML = `
    <div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-800/50"><tr><th class="px-4 py-3 text-left">Name</th><th class="px-4 py-3 text-left">Contact</th><th class="px-4 py-3 text-left">Event</th><th class="px-4 py-3 text-left">Date</th><th class="px-4 py-3 text-left">Budget</th><th class="px-4 py-3 text-left">Status</th><th class="px-4 py-3 text-left">Actions</th></tr></thead>
          <tbody>${mockData.bookings.map(booking => `
            <tr class="table-row border-t border-gray-800">
              <td class="px-4 py-3">${escapeHtml(booking.name)}</td>
              <td class="px-4 py-3">${escapeHtml(booking.phone)}<br><span class="text-xs text-gray-500">${escapeHtml(booking.email)}</span></td>
              <td class="px-4 py-3">${escapeHtml(booking.eventType)}</td>
              <td class="px-4 py-3">${new Date(booking.eventDate).toLocaleDateString()}</td>
              <td class="px-4 py-3">${escapeHtml(booking.budget)}</td>
              <td class="px-4 py-3">
                <select onchange="updateBookingStatus('${booking.id}', this.value)" class="bg-gray-800 rounded-lg px-2 py-1 text-sm">
                  <option ${booking.status === 'pending' ? 'selected' : ''}>pending</option>
                  <option ${booking.status === 'confirmed' ? 'selected' : ''}>confirmed</option>
                  <option ${booking.status === 'completed' ? 'selected' : ''}>completed</option>
                  <option ${booking.status === 'cancelled' ? 'selected' : ''}>cancelled</option>
                </select>
              </td>
              <td class="px-4 py-3"><button onclick="viewBookingDetails('${booking.id}')" class="text-purple-400 text-sm">View</button></td>
            </td>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function updateBookingStatus(id, status) {
  mockData.bookings = mockData.bookings.map(b => b.id === id ? { ...b, status } : b);
  Swal.fire({ icon: 'success', title: `Status updated to ${status}`, timer: 1500, showConfirmButton: false, background: '#1e1e2a', color: '#fff' });
}

function viewBookingDetails(id) {
  const booking = mockData.bookings.find(b => b.id === id);
  if (!booking) return;
  
  Swal.fire({ 
    title: 'Booking Details', 
    html: `<div class="text-left"><p><strong>Name:</strong> ${escapeHtml(booking.name)}</p><p><strong>Email:</strong> ${escapeHtml(booking.email)}</p><p><strong>Phone:</strong> ${escapeHtml(booking.phone)}</p><p><strong>Event:</strong> ${escapeHtml(booking.eventType)}</p><p><strong>Date:</strong> ${new Date(booking.eventDate).toLocaleDateString()}</p><p><strong>Guests:</strong> ${escapeHtml(booking.guestCount)}</p><p><strong>Budget:</strong> ${escapeHtml(booking.budget)}</p><p><strong>Venue:</strong> ${escapeHtml(booking.venue)}</p></div>`, 
    icon: 'info', 
    background: '#1e1e2a', 
    color: '#fff',
    confirmButtonColor: '#7c4dff'
  });
}

// ==================== UTILITIES ====================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => { 
    btn.classList.remove('border-purple-500', 'text-purple-400'); 
    btn.classList.add('border-transparent'); 
  });
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (activeBtn) { 
    activeBtn.classList.add('border-purple-500', 'text-purple-400'); 
    activeBtn.classList.remove('border-transparent'); 
  }
  
  if (tab === 'dashboard') renderDashboardContent();
  else if (tab === 'events') renderEvents();
  else if (tab === 'gallery') renderGallery();
  else if (tab === 'reviews') renderReviews();
  else if (tab === 'marketing') renderMarketing();
  else if (tab === 'bookings') renderBookings();
}

function closeModal() {
  const modal = document.getElementById('formModal');
  if (modal) modal.classList.add('hidden');
  currentEditId = null;
}

// Expose functions globally
window.switchTab = switchTab;
window.editEvent = editEvent;
window.deleteEvent = deleteEvent;
window.deleteImage = deleteImage;
window.approveReview = approveReview;
window.deleteReview = deleteReview;
window.toggleBanner = toggleBanner;
window.deleteBanner = deleteBanner;
window.updateBookingStatus = updateBookingStatus;
window.viewBookingDetails = viewBookingDetails;
window.openGalleryForm = openGalleryForm;
window.openMarketingForm = openMarketingForm;
window.openEventForm = openEventForm;

// ==================== INITIALIZE ====================
document.addEventListener('DOMContentLoaded', () => {
  // Load persisted gallery first
  loadPersistedGallery();
  
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const saveModalBtn = document.getElementById('saveModalBtn');
  const addNewBtn = document.getElementById('addNewBtn');
  
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeModal);
  
  if (saveModalBtn) {
    saveModalBtn.addEventListener('click', () => {
      if (document.getElementById('eventTitle')) saveEvent();
      else if (document.getElementById('galleryTitle')) saveGallery();
      else if (document.getElementById('bannerMessage')) saveMarketing();
    });
  }
  
  if (addNewBtn) {
    addNewBtn.addEventListener('click', () => {
      if (currentTab === 'events') openEventForm();
      else if (currentTab === 'gallery') openGalleryForm();
      else if (currentTab === 'marketing') openMarketingForm();
    });
  }
  
  checkAuth();
});