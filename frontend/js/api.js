// ==================== API CLIENT FOR LAWIE SOUNDS ====================
// Version: 2.0 (Production Ready)
// Author: kelvin ndegwa

// ==================== CONFIGURATION ====================
const API_CONFIG = {
    baseURL: 'http://localhost:5000/api/admin',  // Change to production URL when deploying
    timeout: 30000, // 30 seconds
    retryAttempts: 3,
    retryDelay: 1000
};

// ==================== HELPER FUNCTIONS ====================
function getAuthToken() {
    // Check localStorage first, then sessionStorage
    let session = localStorage.getItem('lawie_admin_session');
    if (!session) session = sessionStorage.getItem('lawie_admin_session');
    
    if (session) {
        try {
            const sessionData = JSON.parse(atob(session));
            return sessionData.token || null;
        } catch (e) {
            return null;
        }
    }
    return null;
}

function getHeaders(requiresAuth = false) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    if (requiresAuth) {
        const token = getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }
    
    return headers;
}

function handleResponse(response) {
    if (!response.ok) {
        // Handle specific HTTP status codes
        if (response.status === 401) {
            // Unauthorized - clear session and redirect to login
            localStorage.removeItem('lawie_admin_session');
            sessionStorage.removeItem('lawie_admin_session');
            if (window.location.pathname.includes('/admin/')) {
                window.location.href = 'login.html';
            }
            throw new Error('Session expired. Please login again.');
        }
        
        if (response.status === 403) {
            throw new Error('You do not have permission to perform this action.');
        }
        
        if (response.status === 404) {
            throw new Error('Resource not found.');
        }
        
        if (response.status === 429) {
            throw new Error('Too many requests. Please try again later.');
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response.json();
}

async function fetchWithRetry(url, options, retries = API_CONFIG.retryAttempts) {
    try {
        const response = await fetch(url, options);
        return await handleResponse(response);
    } catch (error) {
        if (retries > 0 && error.message !== 'Session expired. Please login again.') {
            console.warn(`Retry attempt ${API_CONFIG.retryAttempts - retries + 1} for ${url}`);
            await new Promise(resolve => setTimeout(resolve, API_CONFIG.retryDelay));
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

// ==================== SERVICES API ====================
const ServicesAPI = {
    // Get all services (public)
    async getAll(params = {}) {
        const queryParams = new URLSearchParams(params).toString();
        const url = `${API_CONFIG.baseURL}/services${queryParams ? `?${queryParams}` : ''}`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Get single service by ID or slug (public)
    async getById(id) {
        const url = `${API_CONFIG.baseURL}/services/${encodeURIComponent(id)}`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Get active services only (public)
    async getActive() {
        return this.getAll({ is_active: 'eq.true', order: 'display_order.asc' });
    },
    
    // Create new service (admin only)
    async create(serviceData) {
        const url = `${API_CONFIG.baseURL}/services`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(true),
            body: JSON.stringify(serviceData)
        });
    },
    
    // Update service (admin only)
    async update(id, serviceData) {
        const url = `${API_CONFIG.baseURL}/services?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'PATCH',
            headers: getHeaders(true),
            body: JSON.stringify(serviceData)
        });
    },
    
    // Delete service (admin only)
    async delete(id) {
        const url = `${API_CONFIG.baseURL}/services?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'DELETE',
            headers: getHeaders(true)
        });
    },
    
    // Get services by category
    async getByCategory(category) {
        return this.getAll({ category: `eq.${category}`, is_active: 'eq.true' });
    }
};

// ==================== EVENTS API ====================
const EventsAPI = {
    // Get all events (public)
    async getAll(params = {}) {
        const queryParams = new URLSearchParams(params).toString();
        const url = `${API_CONFIG.baseURL}/events${queryParams ? `?${queryParams}` : ''}`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Get upcoming events (public)
    async getUpcoming(limit = 6) {
        const today = new Date().toISOString().split('T')[0];
        return this.getAll({ 
            event_date: `gte.${today}`, 
            is_active: 'eq.true',
            order: 'event_date.asc',
            limit 
        });
    },
    
    // Get single event (public)
    async getById(id) {
        const url = `${API_CONFIG.baseURL}/events/${encodeURIComponent(id)}`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Create event (admin only)
    async create(eventData) {
        const url = `${API_CONFIG.baseURL}/events`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(true),
            body: JSON.stringify(eventData)
        });
    },
    
    // Update event (admin only)
    async update(id, eventData) {
        const url = `${API_CONFIG.baseURL}/events?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'PATCH',
            headers: getHeaders(true),
            body: JSON.stringify(eventData)
        });
    },
    
    // Delete event (admin only)
    async delete(id) {
        const url = `${API_CONFIG.baseURL}/events?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'DELETE',
            headers: getHeaders(true)
        });
    }
};

// ==================== BOOKINGS API ====================
const BookingsAPI = {
    // Submit a booking (public)
    async create(bookingData) {
        const url = `${API_CONFIG.baseURL}/bookings`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(false),
            body: JSON.stringify(bookingData)
        });
    },
    
    // Get all bookings (admin only)
    async getAll(params = {}) {
        const queryParams = new URLSearchParams(params).toString();
        const url = `${API_CONFIG.baseURL}/bookings${queryParams ? `?${queryParams}` : ''}`;
        return fetchWithRetry(url, {
            method: 'GET',
            headers: getHeaders(true)
        });
    },
    
    // Get single booking (admin only)
    async getById(id) {
        const url = `${API_CONFIG.baseURL}/bookings/${encodeURIComponent(id)}`;
        return fetchWithRetry(url, {
            method: 'GET',
            headers: getHeaders(true)
        });
    },
    
    // Update booking status (admin only)
    async updateStatus(id, status) {
        const url = `${API_CONFIG.baseURL}/bookings/${encodeURIComponent(id)}`;
        return fetchWithRetry(url, {
            method: 'PATCH',
            headers: getHeaders(true),
            body: JSON.stringify({ status })
        });
    },
    
    // Delete booking (admin only)
    async delete(id) {
        const url = `${API_CONFIG.baseURL}/bookings?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'DELETE',
            headers: getHeaders(true)
        });
    },
    
    // Get booking statistics (admin only)
    async getStats() {
        const url = `${API_CONFIG.baseURL}/bookings/stats`;
        return fetchWithRetry(url, {
            method: 'GET',
            headers: getHeaders(true)
        });
    }
};

// ==================== GALLERY API ====================
const GalleryAPI = {
    // Get all gallery images (public)
    async getAll(params = {}) {
        const queryParams = new URLSearchParams(params).toString();
        const url = `${API_CONFIG.baseURL}/gallery${queryParams ? `?${queryParams}` : ''}`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Get images by category (public)
    async getByCategory(category) {
        return this.getAll({ category: `eq.${category}` });
    },
    
    // Upload new image (admin only)
    async upload(formData) {
        const url = `${API_CONFIG.baseURL}/gallery`;
        const token = getAuthToken();
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: formData
        });
        
        return handleResponse(response);
    },
    
    // Delete image (admin only)
    async delete(id) {
        const url = `${API_CONFIG.baseURL}/gallery?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'DELETE',
            headers: getHeaders(true)
        });
    },
    
    // Add image URL (admin only - for external images)
    async addImage(imageData) {
        const url = `${API_CONFIG.baseURL}/gallery`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(true),
            body: JSON.stringify(imageData)
        });
    }
};

// ==================== REVIEWS API ====================
const ReviewsAPI = {
    // Get approved reviews (public)
    async getApproved(limit = 6) {
        const url = `${API_CONFIG.baseURL}/reviews?is_approved=eq.true&order=created_at.desc&limit=${limit}`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Get all reviews (admin only)
    async getAll(params = {}) {
        const queryParams = new URLSearchParams(params).toString();
        const url = `${API_CONFIG.baseURL}/reviews${queryParams ? `?${queryParams}` : ''}`;
        return fetchWithRetry(url, {
            method: 'GET',
            headers: getHeaders(true)
        });
    },
    
    // Submit a review (public)
    async create(reviewData) {
        const url = `${API_CONFIG.baseURL}/reviews`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(false),
            body: JSON.stringify(reviewData)
        });
    },
    
    // Approve review (admin only)
    async approve(id) {
        const url = `${API_CONFIG.baseURL}/reviews?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'PATCH',
            headers: getHeaders(true),
            body: JSON.stringify({ is_approved: true })
        });
    },
    
    // Delete review (admin only)
    async delete(id) {
        const url = `${API_CONFIG.baseURL}/reviews?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'DELETE',
            headers: getHeaders(true)
        });
    }
};

// ==================== MARKETING API ====================
const MarketingAPI = {
    // Get active banners (public)
    async getActiveBanners() {
        const today = new Date().toISOString().split('T')[0];
        const url = `${API_CONFIG.baseURL}/marketing_banners?is_active=eq.true&start_date=lte.${today}&end_date=gte.${today}&order=priority.desc`;
        return fetchWithRetry(url, { method: 'GET', headers: getHeaders(false) });
    },
    
    // Get all marketing banners (admin only)
    async getAll() {
        const url = `${API_CONFIG.baseURL}/marketing_banners?order=created_at.desc`;
        return fetchWithRetry(url, {
            method: 'GET',
            headers: getHeaders(true)
        });
    },
    
    // Create banner (admin only)
    async create(bannerData) {
        const url = `${API_CONFIG.baseURL}/marketing_banners`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(true),
            body: JSON.stringify(bannerData)
        });
    },
    
    // Update banner (admin only)
    async update(id, bannerData) {
        const url = `${API_CONFIG.baseURL}/marketing_banners?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'PATCH',
            headers: getHeaders(true),
            body: JSON.stringify(bannerData)
        });
    },
    
    // Delete banner (admin only)
    async delete(id) {
        const url = `${API_CONFIG.baseURL}/marketing_banners?id=eq.${id}`;
        return fetchWithRetry(url, {
            method: 'DELETE',
            headers: getHeaders(true)
        });
    },
    
    // Toggle banner active status (admin only)
    async toggleStatus(id, isActive) {
        return this.update(id, { is_active: isActive });
    }
};

// ==================== AUTH API ====================
const AuthAPI = {
    // Admin login
    async login(username, password) {
        const url = `${API_CONFIG.baseURL}/auth/login`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await handleResponse(response);
        
        if (data.token) {
            // Store session
            const session = {
                token: data.token,
                user: data.user,
                expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
            };
            localStorage.setItem('lawie_admin_session', btoa(JSON.stringify(session)));
        }
        
        return data;
    },
    
    // Logout
    logout() {
        localStorage.removeItem('lawie_admin_session');
        sessionStorage.removeItem('lawie_admin_session');
    },
    
    // Verify token
    async verify() {
        const url = `${API_CONFIG.baseURL}/auth/verify`;
        return fetchWithRetry(url, {
            method: 'GET',
            headers: getHeaders(true)
        });
    },
    
    // Change password (admin only)
    async changePassword(currentPassword, newPassword) {
        const url = `${API_CONFIG.baseURL}/auth/change-password`;
        return fetchWithRetry(url, {
            method: 'POST',
            headers: getHeaders(true),
            body: JSON.stringify({ currentPassword, newPassword })
        });
    },
    
    // Check if user is logged in
    isLoggedIn() {
        const session = localStorage.getItem('lawie_admin_session') || sessionStorage.getItem('lawie_admin_session');
        if (!session) return false;
        
        try {
            const sessionData = JSON.parse(atob(session));
            return sessionData.expires > Date.now();
        } catch (e) {
            return false;
        }
    }
};

// ==================== DASHBOARD STATS API ====================
const DashboardAPI = {
    async getStats() {
        const [events, bookings, reviews, gallery] = await Promise.all([
            EventsAPI.getAll({ select: 'count' }),
            BookingsAPI.getAll({ select: 'count' }),
            ReviewsAPI.getAll({ is_approved: 'eq.false', select: 'count' }),
            GalleryAPI.getAll({ select: 'count' })
        ]);
        
        return {
            events: events.length || 0,
            bookings: bookings.length || 0,
            pendingReviews: reviews.length || 0,
            gallery: gallery.length || 0
        };
    },
    
    async getBookingTrends() {
        const bookings = await BookingsAPI.getAll();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const trends = {};
        
        bookings.forEach(booking => {
            const date = new Date(booking.created_at);
            const monthKey = months[date.getMonth()];
            trends[monthKey] = (trends[monthKey] || 0) + 1;
        });
        
        return Object.entries(trends).slice(-6).map(([month, count]) => ({ month, count }));
    }
};

// ==================== EXPORT MODULE ====================
// For browser global usage
window.API = {
    Services: ServicesAPI,
    Events: EventsAPI,
    Bookings: BookingsAPI,
    Gallery: GalleryAPI,
    Reviews: ReviewsAPI,
    Marketing: MarketingAPI,
    Auth: AuthAPI,
    Dashboard: DashboardAPI,
    config: API_CONFIG
};

// For ES6 module usage (if using bundler)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ServicesAPI,
        EventsAPI,
        BookingsAPI,
        GalleryAPI,
        ReviewsAPI,
        MarketingAPI,
        AuthAPI,
        DashboardAPI,
        API_CONFIG
    };
}