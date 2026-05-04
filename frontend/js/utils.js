// ==================== UTILITY FUNCTIONS FOR LAWIE SOUNDS ====================
// Version: 2.0 (Production Ready)
// Author: Mahatma The Deejay

// ==================== STRING UTILITIES ====================

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param {string} str - The string to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Truncate text to specified length with ellipsis
 * @param {string} str - The string to truncate
 * @param {number} length - Maximum length
 * @returns {string} - Truncated string
 */
function truncateText(str, length = 100) {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.substring(0, length).trim() + '...';
}

/**
 * Convert string to slug (URL-friendly)
 * @param {string} str - The string to slugify
 * @returns {string} - Slugified string
 */
function slugify(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Capitalize first letter of each word
 * @param {string} str - The string to capitalize
 * @returns {string} - Capitalized string
 */
function capitalizeWords(str) {
    if (!str) return '';
    return str.replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Format phone number to Kenyan format
 * @param {string} phone - Phone number to format
 * @returns {string} - Formatted phone number
 */
function formatPhoneNumber(phone) {
    if (!phone) return '';
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle different formats
    if (cleaned.startsWith('254')) {
        cleaned = '0' + cleaned.substring(3);
    }
    
    if (cleaned.length === 10 && cleaned.startsWith('07')) {
        return cleaned.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
    }
    
    return phone;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate Kenyan phone number
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function isValidKenyanPhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return /^(07|01|2547|2541)[0-9]{8}$/.test(cleaned);
}

// ==================== DATE UTILITIES ====================

/**
 * Format date to readable format
 * @param {string|Date} date - Date to format
 * @param {string} format - Format type (full, date, month)
 * @returns {string} - Formatted date string
 */
function formatDate(date, format = 'full') {
    if (!date) return '';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    const options = {
        full: { year: 'numeric', month: 'long', day: 'numeric' },
        date: { year: 'numeric', month: 'short', day: 'numeric' },
        month: { year: 'numeric', month: 'long' },
        time: { hour: '2-digit', minute: '2-digit' }
    };
    
    return d.toLocaleDateString('en-KE', options[format] || options.full);
}

/**
 * Check if date is in the past
 * @param {string|Date} date - Date to check
 * @returns {boolean} - True if past
 */
function isPastDate(date) {
    const d = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
}

/**
 * Check if date is today
 * @param {string|Date} date - Date to check
 * @returns {boolean} - True if today
 */
function isToday(date) {
    const d = new Date(date);
    const today = new Date();
    return d.toDateString() === today.toDateString();
}

/**
 * Get relative time (e.g., "2 days ago")
 * @param {string|Date} date - Date to convert
 * @returns {string} - Relative time string
 */
function getRelativeTime(date) {
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);
    
    if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
    if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    if (diffWeeks > 0) return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    return 'Just now';
}

// ==================== NUMBER UTILITIES ====================

/**
 * Format currency in Kenyan Shillings
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency string
 */
function formatCurrency(amount) {
    if (amount === undefined || amount === null) return 'KES 0';
    return `KES ${amount.toLocaleString()}`;
}

/**
 * Format number with K/M suffix (e.g., 1.5K, 2.3M)
 * @param {number} num - Number to format
 * @returns {string} - Formatted number
 */
function formatCompactNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Generate random number between min and max
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} - Random number
 */
function randomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ==================== ARRAY UTILITIES ====================

/**
 * Group array by key
 * @param {Array} array - Array to group
 * @param {string} key - Key to group by
 * @returns {Object} - Grouped object
 */
function groupBy(array, key) {
    return array.reduce((result, item) => {
        const groupKey = item[key];
        if (!result[groupKey]) {
            result[groupKey] = [];
        }
        result[groupKey].push(item);
        return result;
    }, {});
}

/**
 * Shuffle array (Fisher-Yates)
 * @param {Array} array - Array to shuffle
 * @returns {Array} - Shuffled array
 */
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Remove duplicates from array
 * @param {Array} array - Array to deduplicate
 * @param {string} key - Optional key for object arrays
 * @returns {Array} - Deduplicated array
 */
function uniqueArray(array, key = null) {
    if (key) {
        const seen = new Set();
        return array.filter(item => {
            const value = item[key];
            if (seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    }
    return [...new Set(array)];
}

// ==================== OBJECT UTILITIES ====================

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} - Cloned object
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Remove empty values from object
 * @param {Object} obj - Object to clean
 * @returns {Object} - Cleaned object
 */
function removeEmptyValues(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined && value !== '') {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Pick specific properties from object
 * @param {Object} obj - Source object
 * @param {Array} keys - Keys to pick
 * @returns {Object} - New object with picked properties
 */
function pick(obj, keys) {
    return keys.reduce((result, key) => {
        if (obj.hasOwnProperty(key)) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

// ==================== STORAGE UTILITIES ====================

/**
 * Set item with expiration
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @param {number} expirationMs - Expiration in milliseconds
 */
function setWithExpiry(key, value, expirationMs) {
    const item = {
        value: value,
        expiry: Date.now() + expirationMs
    };
    localStorage.setItem(key, JSON.stringify(item));
}

/**
 * Get item with expiration check
 * @param {string} key - Storage key
 * @returns {any|null} - Stored value or null if expired
 */
function getWithExpiry(key) {
    const itemStr = localStorage.getItem(key);
    if (!itemStr) return null;
    
    const item = JSON.parse(itemStr);
    if (Date.now() > item.expiry) {
        localStorage.removeItem(key);
        return null;
    }
    return item.value;
}

// ==================== BROWSER UTILITIES ====================

/**
 * Detect if device is mobile
 * @returns {boolean} - True if mobile
 */
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Detect if user is on iOS
 * @returns {boolean} - True if iOS
 */
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Success status
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        return false;
    }
}

/**
 * Get URL parameters as object
 * @returns {Object} - URL parameters
 */
function getUrlParams() {
    const params = {};
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    
    for (const [key, value] of urlParams) {
        params[key] = value;
    }
    return params;
}

/**
 * Update URL parameter without reload
 * @param {string} key - Parameter key
 * @param {string} value - Parameter value
 */
function updateUrlParam(key, value) {
    const url = new URL(window.location.href);
    if (value) {
        url.searchParams.set(key, value);
    } else {
        url.searchParams.delete(key);
    }
    window.history.pushState({}, '', url);
}

// ==================== FORM UTILITIES ====================

/**
 * Serialize form data to object
 * @param {HTMLFormElement} form - Form element
 * @returns {Object} - Form data object
 */
function serializeForm(form) {
    const formData = new FormData(form);
    const data = {};
    for (const [key, value] of formData) {
        data[key] = value;
    }
    return data;
}

/**
 * Validate form fields
 * @param {HTMLFormElement} form - Form element
 * @returns {Object} - Validation result
 */
function validateForm(form) {
    const inputs = form.querySelectorAll('input, select, textarea');
    const errors = {};
    
    inputs.forEach(input => {
        if (input.hasAttribute('required') && !input.value.trim()) {
            errors[input.name || input.id] = 'This field is required';
        }
        
        if (input.type === 'email' && input.value && !isValidEmail(input.value)) {
            errors[input.name || input.id] = 'Please enter a valid email address';
        }
        
        if (input.type === 'tel' && input.value && !isValidKenyanPhone(input.value)) {
            errors[input.name || input.id] = 'Please enter a valid Kenyan phone number';
        }
    });
    
    return {
        isValid: Object.keys(errors).length === 0,
        errors
    };
}

// ==================== UI UTILITIES ====================

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {string} type - Type (success, error, info)
 */
function showToast(message, type = 'info') {
    // Remove existing toast
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) existingToast.remove();
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast-notification fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-full text-white text-sm font-semibold shadow-lg transition-all duration-300 ${
        type === 'success' ? 'bg-green-500' :
        type === 'error' ? 'bg-red-500' : 'bg-blue-500'
    }`;
    toast.textContent = message;
    toast.style.animation = 'fadeInUp 0.3s ease';
    
    document.body.appendChild(toast);
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Show loading spinner on element
 * @param {HTMLElement} element - Target element
 */
function showLoading(element) {
    if (!element) return;
    const originalHtml = element.innerHTML;
    element.dataset.originalHtml = originalHtml;
    element.disabled = true;
    element.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Loading...';
}

/**
 * Hide loading spinner and restore original content
 * @param {HTMLElement} element - Target element
 */
function hideLoading(element) {
    if (!element) return;
    element.disabled = false;
    if (element.dataset.originalHtml) {
        element.innerHTML = element.dataset.originalHtml;
        delete element.dataset.originalHtml;
    }
}

/**
 * Smooth scroll to element
 * @param {string|HTMLElement} target - Target element or selector
 * @param {number} offset - Scroll offset (for fixed header)
 */
function smoothScrollTo(target, offset = 80) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!element) return;
    
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;
    
    window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
    });
}

// ==================== ANIMATION UTILITIES ====================

/**
 * Add fade-in animation to elements when scrolled into view
 * @param {string} selector - CSS selector for elements
 * @param {string} className - Class to add when visible
 */
function initScrollAnimations(selector = '.animate-on-scroll', className = 'visible') {
    const elements = document.querySelectorAll(selector);
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add(className);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    
    elements.forEach(element => observer.observe(element));
}

// ==================== COOKIE UTILITIES ====================

/**
 * Set cookie
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {number} days - Days until expiration
 */
function setCookie(name, value, days = 365) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

/**
 * Get cookie
 * @param {string} name - Cookie name
 * @returns {string|null} - Cookie value or null
 */
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

/**
 * Delete cookie
 * @param {string} name - Cookie name
 */
function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// ==================== EXPORT ====================
// Make utilities available globally
window.Utils = {
    // String utilities
    escapeHtml,
    truncateText,
    slugify,
    capitalizeWords,
    formatPhoneNumber,
    isValidEmail,
    isValidKenyanPhone,
    
    // Date utilities
    formatDate,
    isPastDate,
    isToday,
    getRelativeTime,
    
    // Number utilities
    formatCurrency,
    formatCompactNumber,
    randomNumber,
    
    // Array utilities
    groupBy,
    shuffleArray,
    uniqueArray,
    
    // Object utilities
    deepClone,
    removeEmptyValues,
    pick,
    
    // Storage utilities
    setWithExpiry,
    getWithExpiry,
    
    // Browser utilities
    isMobile,
    isIOS,
    copyToClipboard,
    getUrlParams,
    updateUrlParam,
    
    // Form utilities
    serializeForm,
    validateForm,
    
    // UI utilities
    showToast,
    showLoading,
    hideLoading,
    smoothScrollTo,
    
    // Animation utilities
    initScrollAnimations,
    
    // Cookie utilities
    setCookie,
    getCookie,
    deleteCookie
};

// Add CSS for toast animations
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .animate-on-scroll {
        opacity: 0;
        transform: translateY(30px);
        transition: all 0.6s ease;
    }
    
    .animate-on-scroll.visible {
        opacity: 1;
        transform: translateY(0);
    }
`;
document.head.appendChild(style);

// ==================== AUTO-INITIALIZE ====================
document.addEventListener('DOMContentLoaded', () => {
    // Auto-initialize scroll animations
    initScrollAnimations();
});