// Shared Notification Functions for all pages

// Load and display notifications (available globally)
function getAPIBase() {
    if (typeof window === 'undefined') return 'http://localhost:3000/api';
    if (typeof window.getSwmsApiBase === 'function') return window.getSwmsApiBase();
    if (window.API_BASE) return window.API_BASE;
    if (window.API_BASE_URL) return window.API_BASE_URL;
    return 'http://localhost:3000/api';
}

function getAuthHeaders() {
    const token = (typeof window !== 'undefined' && typeof window.getAuthToken === 'function')
        ? window.getAuthToken()
        : (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('authToken') : null);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

const PENDING_READ_KEY = 'pending_read_id';

async function markNotificationReadById(notificationId) {
    if (!notificationId) return false;
    try {
        if (window.dbAPI && typeof window.dbAPI.markNotificationAsRead === 'function') {
            const res = await window.dbAPI.markNotificationAsRead(notificationId);
            return !!(res && res.success !== false);
        }
        const API_BASE = getAPIBase();
        const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(notificationId)}/read`, {
            method: 'PUT',
            headers: getAuthHeaders()
        });
        const data = await res.json().catch(() => ({}));
        return !!(res.ok && data && data.success !== false);
    } catch (e) {
        return false;
    }
}

window.consumePendingNotificationRead = async function() {
    try {
        if (typeof sessionStorage === 'undefined') return false;
        const pendingId = sessionStorage.getItem(PENDING_READ_KEY);
        if (!pendingId) return false;
        const ok = await markNotificationReadById(pendingId);
        sessionStorage.removeItem(PENDING_READ_KEY);
        if (typeof window.updateNotificationBadge === 'function') {
            await window.updateNotificationBadge();
        }
        return ok;
    } catch (e) {
        try { sessionStorage.removeItem(PENDING_READ_KEY); } catch (_) {}
        return false;
    }
};

async function fetchUnreadCountSafe() {
    const API_BASE = getAPIBase();
    const userId = parseInt(sessionStorage.getItem('userId') || '0', 10);
    const userRole = sessionStorage.getItem('userRole') || 'Admin';
    const userName = sessionStorage.getItem('userName') || ((userRole === 'Admin' || userRole === 'ADMIN') ? 'Admin' : 'Staff Member');
    if (!userId || isNaN(userId)) return 0;

    const params = new URLSearchParams({ userId: String(userId), userRole, userName });
    const headers = getAuthHeaders();
    const endpoints = [
        `${API_BASE}/notifications/unread-count?${params.toString()}`,
        `${API_BASE}/notifications/unread?${params.toString()}`
    ];

    for (const url of endpoints) {
        try {
            let ctrl = null;
            let timeoutId = null;
            if (typeof AbortController !== 'undefined') {
                ctrl = new AbortController();
                timeoutId = setTimeout(() => {
                    try { ctrl.abort(); } catch (e) {}
                }, 6000);
            }
            const res = await fetch(url, {
                headers,
                signal: ctrl ? ctrl.signal : undefined
            });
            if (timeoutId) clearTimeout(timeoutId);
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || !data.success) continue;
            const count = Number(data.unreadCount);
            return Number.isFinite(count) && count > 0 ? count : 0;
        } catch (e) {
            // Continue to fallback endpoint; stay non-blocking.
        }
    }
    return 0;
}

window.updateNotificationBadge = async function() {
    try {
        const unreadCount = await fetchUnreadCountSafe();
        const badge = document.getElementById('notificationBadge');
        if (!badge) return unreadCount;
        badge.textContent = String(unreadCount);
        badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
        return unreadCount;
    } catch (e) {
        // Non-blocking: never let badge updates freeze page logic.
        return 0;
    }
};

window.loadNotifications = async function() {
    try {
        const unreadCount = await window.updateNotificationBadge();

        // Optional: banner on pages that have a `.container` wrapper.
        let notificationBanner = document.getElementById('notificationBanner');
        const container = document.querySelector('.container');
        if (unreadCount > 0 && container) {
            if (!notificationBanner) {
                notificationBanner = document.createElement('div');
                notificationBanner.id = 'notificationBanner';
                notificationBanner.className = 'alert alert-info';
                notificationBanner.style.cssText = 'margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;';
                const pageHeader = document.querySelector('.page-header');
                if (pageHeader) container.insertBefore(notificationBanner, pageHeader);
                else container.insertBefore(notificationBanner, container.firstChild);
            }
            notificationBanner.innerHTML = `
                <span style="cursor:pointer;flex:1;min-width:0;" data-notification-banner-go>
                    <strong>📬 ${unreadCount} new notification${unreadCount > 1 ? 's' : ''}</strong> — Click to open inbox
                </span>
                <button type="button" class="btn btn-outline" style="flex-shrink:0;font-size:0.8rem;padding:0.25rem 0.6rem;" data-notification-banner-dismiss aria-label="Dismiss banner">Dismiss</button>`;
            const go = notificationBanner.querySelector('[data-notification-banner-go]');
            const dismiss = notificationBanner.querySelector('[data-notification-banner-dismiss]');
            if (go) {
                go.onclick = function(e) {
                    e.stopPropagation();
                    window.location.href = 'notifications.html';
                };
            }
            if (dismiss) {
                dismiss.onclick = function(e) {
                    e.stopPropagation();
                    notificationBanner.remove();
                };
            }
        } else if (notificationBanner) {
            notificationBanner.remove();
        }
    } catch (e) {
        // Non-blocking: keep UI stable if notifications endpoint fails.
    }
};

// Auto-refresh badge whenever possible (but avoid overriding notifications.html page logic).
(function() {
    const path = (window.location && window.location.pathname || '').toLowerCase();
    const isNotificationsPage = path.indexOf('notifications.html') !== -1;

    document.addEventListener('DOMContentLoaded', function() {
        if (typeof window.consumePendingNotificationRead === 'function') {
            window.consumePendingNotificationRead();
        }
        if (typeof window.updateNotificationBadge === 'function') window.updateNotificationBadge();
        // Do NOT call window.loadNotifications() here; notifications.html owns its own loader.
    });

    window.addEventListener('pageshow', function() {
        if (typeof window.consumePendingNotificationRead === 'function') {
            window.consumePendingNotificationRead();
        }
        // Badge refresh on return is light-weight.
        if (!isNotificationsPage && typeof window.updateNotificationBadge === 'function') {
            window.updateNotificationBadge();
        }
    });
})();

// Show notifications panel (available globally)
window.showNotificationsPanel = function() {
    const notifications = window.storage.get('notifications') || [];
    const userRole = sessionStorage.getItem('userRole') || 'Admin';
    const currentUser = sessionStorage.getItem('userName') || ((userRole === 'Admin' || userRole === 'ADMIN') ? 'Admin' : 'Staff Member');
    const userNotifications = notifications.filter(notif => 
        notif.recipient === currentUser || notif.recipient === 'Staff Member' || ((userRole === 'Admin' || userRole === 'ADMIN') && notif.recipient === 'Admin')
    ).slice(0, 10);
    
    if (userNotifications.length === 0) {
        showNotification('No notifications', 'info');
        return;
    }
    
    const notificationListHtml = userNotifications.map(notif => {
        const date = new Date(notif.createdAt).toLocaleString();
        return `<div style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-color, #dee2e6);"><strong>${date}</strong><br>${notif.message}</div>`;
    }).join('') + '<p style="margin-top: 1rem; font-size: 0.85rem; color: var(--text-secondary, #666);">(Notifications marked as read)</p>';
    
    const overlay = document.createElement('div');
    overlay.className = 'notification-window-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'notifications-panel-title');
    overlay.innerHTML = `
        <div class="notification-window-box notification-info">
            <div class="notification-window-header notification-info">
                <span id="notifications-panel-title" class="notification-window-title">Your Notifications</span>
                <button type="button" class="notification-window-close" aria-label="Close">&times;</button>
            </div>
            <div class="notification-window-body" style="max-height: 400px; overflow-y: auto;">${notificationListHtml}</div>
            <div class="notification-window-footer">
                <button type="button" class="btn btn-primary" data-notifications-close>OK</button>
            </div>
        </div>
    `;

    const closeBtn = overlay.querySelector('.notification-window-close');
    const okBtn = overlay.querySelector('[data-notifications-close]');
    const prevFocus = document.activeElement;
    const focusables = [closeBtn, okBtn];

    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKeydown);
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    };

    function onKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            return;
        }
        if (e.key === 'Tab') {
            const first = focusables[0], last = focusables[focusables.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }

    closeBtn.onclick = close;
    okBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener('keydown', onKeydown);

    document.body.appendChild(overlay);
    okBtn.focus();
    
    // Mark as read
    userNotifications.forEach(notif => {
        notif.read = true;
    });
    window.storage.set('notifications', notifications);
    window.loadNotifications();
};











