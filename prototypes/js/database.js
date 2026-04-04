// Database API Connection for Prototypes
// This file provides functions to connect prototype pages to the backend database

// Node API runs on port 3000; use that when page is from port 80 (XAMPP) or file://
const API_BASE = (function() {
    if (typeof window === 'undefined') return 'http://localhost:3000/api';
    if (window.API_BASE_URL) return window.API_BASE_URL;
    if (window.API_BASE) return window.API_BASE;
    var loc = window.location;
    var origin = loc && loc.origin;
    if (origin && origin !== 'null') {
        var port = loc.port ? parseInt(loc.port, 10) : (loc.protocol === 'https:' ? 443 : 80);
        if (port === 80 || port === 443 || origin.indexOf(':3000') !== -1) {
            return origin.replace(/\/$/, '') + '/api';
        }
    }
    return 'http://localhost:3000/api';
})();

// Helper: get auth headers (token + optional refresh on 401)
function getAuthHeaders() {
    const token = (typeof window !== 'undefined' && typeof window.getAuthToken === 'function')
        ? window.getAuthToken()
        : (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('authToken') : null);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

// Helper function to make API calls (includes auth token, handles 401)
async function apiCall(endpoint, options = {}) {
    try {
        const headers = { ...getAuthHeaders(), ...options.headers };
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });
        
        let data;
        try {
            data = await response.json();
        } catch (e) {
            data = { success: false, error: 'Invalid response', connectionError: false };
        }
        
        // 503 or 500: Database/connection error - show professional banner
        if (response.status === 503 || response.status === 500) {
            const errMsg = (data && data.error) || (data && data.message) || 'Unable to connect to the database. Please contact the administrator.';
            if (typeof window.showConnectionErrorBanner === 'function') {
                window.showConnectionErrorBanner(errMsg);
            }
            return { success: false, error: errMsg, connectionError: true, data: null };
        }
        
        // 401: try refresh token, else redirect to login
        if (response.status === 401 && headers.Authorization) {
            const refreshToken = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('refreshToken') : null;
            if (refreshToken) {
                try {
                    const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refreshToken })
                    });
                    const refreshData = await refreshRes.json();
                    if (refreshData.success && refreshData.data && refreshData.data.token) {
                        sessionStorage.setItem('authToken', refreshData.data.token);
                        try { localStorage.setItem('authToken', refreshData.data.token); } catch (e) {}
                        return apiCall(endpoint, options); // retry
                    }
                } catch (e) {}
            }
            sessionStorage.removeItem('authToken');
            try { localStorage.removeItem('authToken'); } catch (e) {}
            sessionStorage.removeItem('refreshToken');
            sessionStorage.removeItem('userRole');
            sessionStorage.removeItem('userId');
            sessionStorage.removeItem('userName');
            sessionStorage.removeItem('userEmail');
            sessionStorage.setItem('sessionExpired', '1');
            window.location.href = 'login.html';
            return { success: false, error: 'Session expired' };
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        // Network error (e.g. backend offline)
        const netMsg = 'Unable to reach the server. Please check if the backend is running at ' + (typeof API_BASE !== 'undefined' ? API_BASE : 'localhost:3000') + '.';
        if (typeof window.showConnectionErrorBanner === 'function') {
            window.showConnectionErrorBanner(netMsg);
        }
        return { success: false, error: netMsg, connectionError: true, data: null };
    }
}

// ============================================
// RECEIVING RECORDS (In Records)
// ============================================
async function loadReceivingRecords() {
    try {
        const data = await apiCall('/receiving');
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading receiving records:', error);
        return [];
    }
}

async function createReceivingRecord(recordData) {
    try {
        const data = await apiCall('/receiving', {
            method: 'POST',
            body: JSON.stringify(recordData)
        });
        return data;
    } catch (error) {
        console.error('Error creating receiving record:', error);
        throw error;
    }
}

async function updateReceivingRecord(recordId, updateData) {
    try {
        const data = await apiCall(`/receiving/${recordId}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        return data;
    } catch (error) {
        console.error('Error updating receiving record:', error);
        throw error;
    }
}

// ============================================
// ISSUING RECORDS (Out Records)
// ============================================
async function loadIssuingRecords() {
    try {
        const data = await apiCall('/issuing');
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading issuing records:', error);
        return [];
    }
}

async function createIssuingRecord(recordData) {
    try {
        const data = await apiCall('/issuing', {
            method: 'POST',
            body: JSON.stringify(recordData)
        });
        return data;
    } catch (error) {
        console.error('Error creating issuing record:', error);
        throw error;
    }
}

async function updateIssuingRecord(recordId, updateData) {
    try {
        const data = await apiCall(`/issuing/${recordId}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        return data;
    } catch (error) {
        console.error('Error updating issuing record:', error);
        throw error;
    }
}

// ============================================
// PRODUCTS
// ============================================
async function loadProducts() {
    try {
        const data = await apiCall('/products');
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading products:', error);
        return [];
    }
}

async function updateProduct(productId, updateData) {
    const data = await apiCall(`/products/${productId}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
    });
    return data;
}
if (typeof window !== 'undefined') window.updateProduct = updateProduct;

// ============================================
// BATCHES
// ============================================
async function loadBatches() {
    try {
        const data = await apiCall('/batches');
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading batches:', error);
        return [];
    }
}

async function loadBatchesByProduct(productId) {
    try {
        const data = await apiCall(`/batches/product/${productId}`);
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading batches by product:', error);
        return [];
    }
}

// ============================================
// ALERTS
// ============================================
async function loadAlerts(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.resolved !== undefined) params.append('resolved', filters.resolved);
        if (filters.alertType) params.append('alertType', filters.alertType);
        if (filters.severity) params.append('severity', filters.severity);
        
        const queryString = params.toString();
        const endpoint = queryString ? `/alerts?${queryString}` : '/alerts';
        const data = await apiCall(endpoint);
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading alerts:', error);
        return [];
    }
}

async function resolveAlert(alertId, resolvedBy = null) {
    try {
        const data = await apiCall(`/alerts/${alertId}/resolve`, {
            method: 'PUT',
            body: JSON.stringify({ resolvedBy })
        });
        return data;
    } catch (error) {
        console.error('Error resolving alert:', error);
        throw error;
    }
}

async function runAlertCheck() {
    try {
        const data = await apiCall('/alerts/check');
        return data;
    } catch (error) {
        console.error('Error running alert check:', error);
        throw error;
    }
}

// ============================================
// BOOKINGS
// ============================================
async function loadBookings(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.status) params.append('status', filters.status);
        if (filters.requestedBy) params.append('requestedBy', filters.requestedBy);
        
        const queryString = params.toString();
        const endpoint = queryString ? `/inventory/bookings?${queryString}` : '/inventory/bookings';
        const data = await apiCall(endpoint);
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading bookings:', error);
        return [];
    }
}

async function createBooking(bookingData) {
    try {
        const data = await apiCall('/inventory/bookings', {
            method: 'POST',
            body: JSON.stringify(bookingData)
        });
        return data;
    } catch (error) {
        console.error('Error creating booking:', error);
        throw error;
    }
}

async function approveBooking(bookingId, approvedBy = null, reason = null) {
    try {
        const userId = approvedBy || (typeof sessionStorage !== 'undefined' ? parseInt(sessionStorage.getItem('userId') || '1', 10) : 1);
        const data = await apiCall(`/inventory/bookings/${bookingId}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ approvedBy: userId, reason: reason || '', approvalReason: reason || '' })
        });
        return data;
    } catch (error) {
        console.error('Error approving booking:', error);
        throw error;
    }
}

async function cancelBooking(bookingId, cancelledBy = null, rejectReason = null) {
    try {
        const userId = cancelledBy || (typeof sessionStorage !== 'undefined' ? parseInt(sessionStorage.getItem('userId') || '1', 10) : 1);
        const data = await apiCall(`/inventory/bookings/${bookingId}/cancel`, {
            method: 'PUT',
            body: JSON.stringify({ cancelledBy: userId, rejectReason: rejectReason || null })
        });
        return data;
    } catch (error) {
        console.error('Error cancelling booking:', error);
        throw error;
    }
}

// ============================================
// INVENTORY
// ============================================
async function loadInventory() {
    try {
        const data = await apiCall('/inventory');
        return data.success ? (data.data || []) : [];
    } catch (error) {
        console.error('Error loading inventory:', error);
        return [];
    }
}

// ============================================
// NOTIFICATIONS
// ============================================
async function loadNotifications(userId, userRole, userName) {
    try {
        const params = new URLSearchParams({
            userId: String(userId != null ? userId : ''),
            userRole: String(userRole != null ? userRole : ''),
            userName: String(userName != null ? userName : '')
        });
        const data = await apiCall(`/notifications?${params.toString()}`);
        if (!data || !data.success) return [];
        return Array.isArray(data.data) ? data.data : [];
    } catch (error) {
        console.error('Error loading notifications:', error);
        return [];
    }
}

async function getUnreadNotificationCount(userId, userRole, userName) {
    try {
        const params = new URLSearchParams({
            userId: userId,
            userRole: userRole,
            userName: userName
        });
        const data = await apiCall(`/notifications/unread?${params.toString()}`);
        return data.success ? data.unreadCount : 0;
    } catch (error) {
        console.error('Error loading unread count:', error);
        return 0;
    }
}

async function markNotificationAsRead(notificationId) {
    try {
        const data = await apiCall(`/notifications/${notificationId}/read`, {
            method: 'PUT'
        });
        return data;
    } catch (error) {
        console.error('Error marking notification as read:', error);
        throw error;
    }
}

async function markNotificationAsUnread(notificationId) {
    try {
        const data = await apiCall(`/notifications/${notificationId}/unread`, {
            method: 'PUT'
        });
        return data;
    } catch (error) {
        console.error('Error marking notification as unread:', error);
        throw error;
    }
}

async function deleteNotification(notificationId) {
    try {
        const data = await apiCall(`/notifications/${notificationId}`, {
            method: 'DELETE'
        });
        return data;
    } catch (error) {
        console.error('Error deleting notification:', error);
        throw error;
    }
}

async function markAllNotificationsAsRead(userId, userRole, userName) {
    try {
        const data = await apiCall('/notifications/read-all', {
            method: 'PUT',
            body: JSON.stringify({ userId, userRole, userName })
        });
        return data;
    } catch (error) {
        console.error('Error marking all as read:', error);
        throw error;
    }
}

async function clearAllNotifications(userId, userRole, userName) {
    try {
        const data = await apiCall('/notifications/clear-all', {
            method: 'DELETE',
            body: JSON.stringify({ userId, userRole, userName })
        });
        return data;
    } catch (error) {
        console.error('Error clearing all notifications:', error);
        throw error;
    }
}

async function createNotification(notificationData) {
    try {
        const data = await apiCall('/notifications', {
            method: 'POST',
            body: JSON.stringify(notificationData)
        });
        return data;
    } catch (error) {
        console.error('Error creating notification:', error);
        throw error;
    }
}

// Export functions for use in pages
window.dbAPI = {
    loadReceivingRecords,
    createReceivingRecord,
    updateReceivingRecord,
    loadIssuingRecords,
    createIssuingRecord,
    updateIssuingRecord,
    loadProducts,
    updateProduct,
    loadBatches,
    loadBatchesByProduct,
    loadAlerts,
    resolveAlert,
    runAlertCheck,
    loadBookings,
    createBooking,
    approveBooking,
    cancelBooking,
    loadInventory,
    loadNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
    markNotificationAsUnread,
    deleteNotification,
    markAllNotificationsAsRead,
    clearAllNotifications,
    createNotification
};

