// SWMS Web Prototypes - Shared JavaScript

// Centralized API base: point at the Node backend (default :3000) when the UI is on another port
// (Live Server, Vite, etc.). Use same-origin /api only when the page is already on the API port,
// or on 80/443 (typical reverse-proxy). Avoid location.origin+/api for random dev ports (e.g. :3001)
// — that caused "Failed to fetch" because nothing listened there.
(function initApiBase() {
    // Split hosting (e.g. UI on GitHub Pages, API on Railway): set in js/api-config.js
    if (typeof window !== 'undefined' && typeof window.__SWMS_API_BASE__ === 'string') {
        var forced = window.__SWMS_API_BASE__.trim();
        if (forced) {
            forced = forced.replace(/\/$/, '');
            if (!/\/api$/i.test(forced)) forced = forced + '/api';
            window.API_BASE = window.API_BASE_URL = forced;
            return;
        }
    }
    if (typeof window === 'undefined' || !window.location) {
        window.API_BASE = window.API_BASE_URL = 'http://localhost:3000/api';
        return;
    }
    var loc = window.location;
    if (loc.protocol !== 'http:' && loc.protocol !== 'https:') {
        window.API_BASE = window.API_BASE_URL = 'http://localhost:3000/api';
        return;
    }
    var apiPort = '3000';
    if (typeof window.__SWMS_API_PORT__ !== 'undefined' && window.__SWMS_API_PORT__ !== '') {
        apiPort = String(window.__SWMS_API_PORT__).replace(/[^0-9]/g, '') || '3000';
    } else {
        try {
            var saved = localStorage.getItem('swms_api_port');
            if (saved && /^\d{2,5}$/.test(String(saved).trim())) apiPort = String(saved).trim();
        } catch (e) {}
    }
    var apiNum = parseInt(apiPort, 10) || 3000;
    var portStr = loc.port;
    var pNum = portStr ? parseInt(portStr, 10) : (loc.protocol === 'https:' ? 443 : 80);
    if (isNaN(pNum)) pNum = loc.protocol === 'https:' ? 443 : 80;

    var host = loc.hostname || 'localhost';
    var staticDevPorts = [5500, 5501, 8080, 8888, 5000, 4173, 5173];
    var o = loc.origin;
    var useExplicitApiHost = staticDevPorts.indexOf(pNum) >= 0
        || (pNum !== apiNum && pNum !== 80 && pNum !== 443);

    if (useExplicitApiHost) {
        window.API_BASE = window.API_BASE_URL = loc.protocol + '//' + host + ':' + apiPort + '/api';
        return;
    }
    if (o && o !== 'null') {
        window.API_BASE = window.API_BASE_URL = o.replace(/\/$/, '') + '/api';
    } else {
        window.API_BASE = window.API_BASE_URL = 'http://localhost:3000/api';
    }
})();

/** Safe for inline scripts: never use location.origin+/api as fallback (wrong port when UI ≠ API). */
window.getSwmsApiBase = function() {
    return window.API_BASE || window.API_BASE_URL || 'http://localhost:3000/api';
};
const API_BASE = window.API_BASE;

/**
 * JWT from sessionStorage, then localStorage (login writes both for cross-tab use).
 * Syncs missing side so new tabs and fetchWithAuth agree on the same token.
 */
function getAuthToken() {
    var s = sessionStorage.getItem('authToken');
    var l = null;
    try { l = localStorage.getItem('authToken'); } catch (e) {}
    var t = (s && String(s).trim()) ? String(s).trim() : ((l && String(l).trim()) ? String(l).trim() : '');
    if (t && !s && l) {
        try { sessionStorage.setItem('authToken', t); } catch (e) {}
    } else if (t && s && !l) {
        try { localStorage.setItem('authToken', t); } catch (e) {}
    }
    return t;
}
window.getAuthToken = getAuthToken;

// -----------------------------------------------------------------------------
// Alerts prototype compatibility
// -----------------------------------------------------------------------------
// Some pages (notably `alerts.html`) may route API calls through a legacy
// `api-proxy.php?path=...` endpoint when they think they're on XAMPP.
// That PHP proxy doesn't exist in this repo, so the UI ends up with empty data.
// We transparently forward those requests to the real backend `/api/*`.
(function patchLegacyApiProxyFetch() {
    if (typeof window === 'undefined' || !window.fetch) return;
    if (window.__swmsLegacyApiProxyFetchPatched) return;
    window.__swmsLegacyApiProxyFetchPatched = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
        try {
            const url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
            if (url && url.includes('api-proxy.php?path=')) {
                const marker = 'api-proxy.php?path=';
                const idx = url.indexOf(marker);
                const pathParam = idx >= 0 ? url.slice(idx + marker.length) : '';

                const base = window.API_BASE_URL || window.API_BASE || 'http://localhost:3000/api';
                // `pathParam` is usually something like `/alerts` or `/alerts?resolved=false`
                const cleanedPath = pathParam.startsWith('/') ? pathParam : '/' + pathParam;
                const forwardedUrl = base.replace(/\/$/, '') + cleanedPath;
                return originalFetch(forwardedUrl, init);
            }
        } catch (e) {
            // Fall back to original fetch
        }
        return originalFetch(input, init);
    };
})();

// Authenticated fetch - adds Bearer token, handles 401 (refresh + redirect)
window.fetchWithAuth = async function(url, options) {
    const authRetry = Math.min(3, Math.max(0, parseInt((options && options._authRetry) || 0, 10) || 0));
    const safeOpts = (options != null && typeof options === 'object') ? options : {};
    const { _authRetry: _omit, ...restOptions } = safeOpts;
    const headers = { 'Content-Type': 'application/json', ...(restOptions.headers || {}) };
    const token = getAuthToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let res;
    try {
        res = await fetch(url, { ...restOptions, headers });
    } catch (netErr) {
        if (typeof window.showNotification === 'function') {
            window.showNotification('Error', netErr.message || 'Unable to reach the server. Please check if the backend is running.', 'error');
        }
        if (typeof window.showConnectionErrorBanner === 'function') {
            window.showConnectionErrorBanner('Unable to reach the server. Please check if the backend is running.');
        }
        throw netErr;
    }
    if (res.status === 503 || res.status === 500) {
        res.clone().json().then(function(d) {
            const msg = (d && (d.message || d.error)) || 'Unable to connect to the database. Please contact the administrator.';
            if (typeof window.showNotification === 'function') window.showNotification('Error', msg, 'error');
            if (typeof window.showConnectionErrorBanner === 'function') window.showConnectionErrorBanner(msg);
        }).catch(function() {
            const msg = 'Unable to connect to the database. Please contact the administrator.';
            if (typeof window.showNotification === 'function') window.showNotification('Error', msg, 'error');
            if (typeof window.showConnectionErrorBanner === 'function') window.showConnectionErrorBanner(msg);
        });
    }
    if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || data.message || 'Access denied. Admin required.';
        if (typeof window.showNotification === 'function') {
            window.showNotification('Error', msg, 'error');
        }
        throw new Error(msg);
    }
    if (res.status === 401) {
        const rt = sessionStorage.getItem('refreshToken');
        if (rt && authRetry < 2) {
            try {
                const refRes = await fetch(API_BASE + '/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: rt }),
                    signal: restOptions.signal
                });
                const refData = await refRes.json().catch(() => ({}));
                if (refData.success && refData.data && refData.data.token) {
                    sessionStorage.setItem('authToken', refData.data.token);
                    try { localStorage.setItem('authToken', refData.data.token); } catch (e) {}
                    return window.fetchWithAuth(url, { ...restOptions, _authRetry: authRetry + 1 });
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
        window.location.href = '/login.html';
        throw new Error('Session expired');
    }
    return res;
};

// Unified Window Box Notification: showNotification(title, message, type)
// Backward compat: showNotification(message, type) or showNotification(message, type, duration) or showNotification(title, message, type, options)
// type: 'success' | 'error' | 'warning' | 'info'. Success/Info use Muted Green (#4D7C0F).
// Persistent only: window-box notifications do not auto-dismiss; user closes manually. options: { href: 'approval.html' } for click-to-navigate.
const NOTIFICATION_DEFAULT_TITLES = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Notice' };
const NOTIFICATION_ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };
const NOTIFICATION_AUTO_CLOSE_MS = 0;

window.showNotification = function(titleOrMessage, messageOrType, typeOrDuration, options) {
    let title, message, type, duration = NOTIFICATION_AUTO_CLOSE_MS;
    const opts = (options && typeof options === 'object') ? options : {};
    if (arguments.length === 1) {
        message = String(titleOrMessage);
        type = 'info';
        title = NOTIFICATION_DEFAULT_TITLES[type];
    } else if (arguments.length === 2) {
        message = String(titleOrMessage);
        type = (messageOrType && typeof messageOrType === 'string') ? messageOrType : 'info';
        title = NOTIFICATION_DEFAULT_TITLES[type] || NOTIFICATION_DEFAULT_TITLES.info;
    } else {
        if (typeof typeOrDuration === 'number') {
            message = String(titleOrMessage);
            type = (messageOrType && typeof messageOrType === 'string') ? messageOrType : 'info';
            duration = typeOrDuration;
            title = NOTIFICATION_DEFAULT_TITLES[type] || NOTIFICATION_DEFAULT_TITLES.info;
        } else {
            title = String(titleOrMessage);
            message = String(messageOrType);
            type = (typeOrDuration && typeof typeOrDuration === 'string') ? typeOrDuration : 'info';
        }
    }
    const icon = NOTIFICATION_ICONS[type] || NOTIFICATION_ICONS.info;
    const safeTitle = (title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeMessage = (message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const overlay = document.createElement('div');
    overlay.className = 'swms-notification-overlay';
    overlay.style.zIndex = '10100';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title || 'Notification');

    const box = document.createElement('div');
    box.className = 'notification-window-box notification-box notification-' + type;
    box.setAttribute('role', 'alert');
    box.setAttribute('aria-live', 'assertive');
    box.innerHTML = `
        <div class="notification-window-header notification-${type}">
            <span class="notification-window-title-wrap">
                <i data-lucide="${icon}" class="notification-window-icon" aria-hidden="true"></i>
                <span class="notification-window-title">${safeTitle}</span>
            </span>
            <button type="button" class="notification-window-close" aria-label="Close notification">&times;</button>
        </div>
        <div class="notification-window-body">${safeMessage}</div>
    `;

    const closeBtn = box.querySelector('.notification-window-close');
    let autoCloseTimer = null;

    function onNotifyKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }

    const close = () => {
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        document.removeEventListener('keydown', onNotifyKeydown);
        box.classList.add('notification-window-box--closing');
        setTimeout(() => {
            overlay.remove();
        }, 200);
    };

    document.addEventListener('keydown', onNotifyKeydown);
    closeBtn.addEventListener('click', function(e) { e.stopPropagation(); close(); });
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) close();
    });
    // Intentionally no auto-close for window-box notifications.
    // Keep `duration` parsing only for backward API compatibility.
    var href = opts.href || opts.link;
    if (href && typeof href === 'string') {
        var bodyEl = box.querySelector('.notification-window-body');
        if (bodyEl) {
            bodyEl.style.cursor = 'pointer';
            bodyEl.setAttribute('title', 'Click to go to ' + href);
            bodyEl.addEventListener('click', function() {
                close();
                window.location.href = href;
            });
        }
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        try { lucide.createIcons({ attrs: { 'stroke-width': 1.5 } }); } catch (e) {}
    }
    closeBtn.focus();
};

// Connection error banner - professional muted red banner (Business Formal theme)
window.showConnectionErrorBanner = function(message) {
    const msg = message || 'Unable to connect to the database. Please contact the administrator.';
    let banner = document.getElementById('swms-connection-error-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'swms-connection-error-banner';
        banner.setAttribute('role', 'alert');
        banner.style.cssText = 'background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:0.75rem 1rem;margin-bottom:1rem;border-radius:6px;font-size:0.875rem;display:flex;align-items:center;gap:0.5rem;';
        const main = document.querySelector('main, .container-fluid, .container, [role="main"]');
        if (main) {
            main.insertBefore(banner, main.firstChild);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }
    banner.innerHTML = '<span style="flex:1;">' + (msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span><button type="button" onclick="this.parentElement.style.display=\'none\'" style="background:none;border:none;color:inherit;cursor:pointer;padding:0.25rem;">&times;</button>';
    banner.style.display = 'flex';
};
window.hideConnectionErrorBanner = function() {
    const banner = document.getElementById('swms-connection-error-banner');
    if (banner) banner.style.display = 'none';
};

// Custom form validation: replace browser bubbles with window box notification
function swmsGetValidationMessage(input) {
    const label = (input.labels && input.labels[0] && input.labels[0].textContent) || input.name || input.placeholder || 'This field';
    const value = input.value.trim();
    if (input.required && !value) return (label.replace(/\s*\*?\s*$/, '') + ' is required.');
    const min = input.getAttribute('min');
    const max = input.getAttribute('max');
    const num = input.type === 'number' || input.getAttribute('type') === 'number' ? parseFloat(value) : NaN;
    if (min != null && !isNaN(num) && num < parseFloat(min)) return 'Value must be greater than or equal to ' + min + '.';
    if (max != null && !isNaN(num) && num > parseFloat(max)) return 'Value must be less than or equal to ' + max + '.';
    if (input.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address.';
    if (input.minLength && value.length < parseInt(input.minLength, 10)) return (label + ' must be at least ' + input.minLength + ' characters.');
    return null;
}
function swmsValidateForm(form) {
    const inputs = form.querySelectorAll('input, textarea, select');
    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        if (input.disabled || input.type === 'submit' || input.type === 'button' || input.type === 'hidden') continue;
        const msg = swmsGetValidationMessage(input);
        if (msg) return { valid: false, message: msg, element: input };
    }
    return { valid: true };
}
function swmsSetupFormValidation() {
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form && form.getAttribute('novalidate') !== null && typeof window.showNotification === 'function') {
            const result = swmsValidateForm(form);
            if (!result.valid) {
                e.preventDefault();
                e.stopPropagation();
                window.showNotification('Validation Error', result.message, 'error');
                if (result.element) {
                    result.element.focus();
                    try { result.element.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) {}
                }
                return false;
            }
        }
    }, true);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', swmsSetupFormValidation);
} else {
    swmsSetupFormValidation();
}

// Page load notification disabled: only show notifications for user actions (Save, Send, Delete) or errors.
function swmsPageLoadNotification() {
    // No-op: do not show "Page loaded successfully" to reduce notification fatigue.
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(swmsPageLoadNotification, 400); });
} else {
    setTimeout(swmsPageLoadNotification, 400);
}

// Prompt window box (like add supplier form) - for entering information
window.showPromptWindow = function(title, message, options = {}) {
    const placeholder = (options.placeholder || '').replace(/"/g, '&quot;');
    const defaultValue = options.defaultValue != null ? String(options.defaultValue) : '';
    const multiline = options.multiline !== false;
    const submitLabel = options.submitLabel || 'Submit';
    const cancelLabel = options.cancelLabel || 'Cancel';

    return new Promise(function(resolve) {
        const overlay = document.createElement('div');
        overlay.className = 'notification-window-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const inputTag = multiline ? 'textarea' : 'input';
        const inputAttrs = multiline
            ? `rows="3" placeholder="${placeholder}" class="form-input form-textarea" style="width:100%;resize:vertical;"`
            : `type="text" placeholder="${placeholder}" class="form-input" style="width:100%;" value="${defaultValue.replace(/"/g, '&quot;')}"`;
        overlay.innerHTML = `
            <div class="notification-window-box notification-info" data-enter-submit="#promptSubmitBtn">
                <div class="notification-window-header notification-info">
                    <span class="notification-window-title">${title}</span>
                    <button type="button" class="notification-window-close" aria-label="Close">&times;</button>
                </div>
                <div class="notification-window-body">
                    ${message ? `<p style="margin-bottom:1rem;color:var(--text-secondary);">${message}</p>` : ''}
                    <div class="form-group" style="margin:0;">
                        <label class="form-label">${options.label || 'Enter value'}</label>
                        <${inputTag} id="promptInput" ${inputAttrs}></${inputTag}>
                    </div>
                </div>
                <div class="notification-window-footer">
                    <button type="button" class="btn btn-outline" data-prompt-cancel>${cancelLabel}</button>
                    <button type="button" class="btn btn-primary" data-prompt-submit id="promptSubmitBtn">${submitLabel}</button>
                </div>
            </div>
        `;

        const inputEl = overlay.querySelector('#promptInput');
        if (defaultValue && multiline) inputEl.value = defaultValue;

        const close = function(value) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.2s ease';
            setTimeout(function() {
                overlay.remove();
                document.removeEventListener('keydown', onKeydown);
                resolve(value);
            }, 200);
        };

        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(null);
            }
        }

        overlay.querySelector('.notification-window-close').onclick = function() { close(null); };
        overlay.querySelector('[data-prompt-cancel]').onclick = function() { close(null); };
        overlay.querySelector('[data-prompt-submit]').onclick = function() {
            const v = inputEl.value.trim();
            if (!options.allowEmpty && !v) {
                inputEl.style.borderColor = 'var(--danger-color)';
                inputEl.focus();
                if (typeof window.showNotification === 'function') window.showNotification('Reason required', 'Reason cannot be empty. Please fill in a reason before taking this action.', 'error');
                return;
            }
            inputEl.style.borderColor = '';
            close(v);
        };
        overlay.onclick = function(e) { if (e.target === overlay) close(null); };
        document.addEventListener('keydown', onKeydown);

        document.body.appendChild(overlay);
        inputEl.focus();
    });
};

// Unified Approval/Reject Reason Modal
// Returns a Promise<string|null> (null means cancelled).
window.showApprovalReasonModal = function(cfg = {}) {
    const action = String(cfg.action || '').toLowerCase() === 'reject' ? 'reject' : 'approve';
    const title = String(cfg.title || (action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'));
    const required = cfg.required !== false; // default: true
    const placeholder = String(cfg.placeholder || 'e.g. OK');
    const description = cfg.description
        ? String(cfg.description)
        : (action === 'reject'
            ? 'Please provide a reason for rejection. This will be stored and shown to the requester.'
            : 'Please provide a reason for approval. This will be stored and shown to the requester.');
    const confirmText = String(cfg.confirmText || (action === 'approve' ? 'Submit Approval' : 'Submit Rejection'));
    const cancelText = String(cfg.cancelText || 'Cancel');

    const confirmBg = action === 'approve' ? '#15803D' : '#B91C1C';

    return new Promise(function(resolve) {
        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.style.display = 'block';
        backdrop.style.cssText = [
            'display: none;',
            'position: fixed;',
            'top: 0;',
            'left: 0;',
            'width: 100%;',
            'height: 100%;',
            'background: rgba(0,0,0,0.5);',
            'z-index: 1100;'
        ].join('');
        backdrop.style.display = 'block';

        // Modal container
        const modal = document.createElement('div');
        modal.className = 'card';
        modal.style.cssText = [
            'display: block;',
            'position: fixed;',
            'top: 50%;',
            'left: 50%;',
            'transform: translate(-50%, -50%);',
            'z-index: 1101;',
            'max-width: 420px;',
            'width: 90%;',
            'background: #fff;',
            'box-shadow: 0 2px 12px rgba(0,0,0,0.10);',
            'border: 1px solid var(--border, #e5e7eb);',
            'border-radius: 4px;'
        ].join('');

        // Header
        const header = document.createElement('div');
        header.className = 'card-header';
        header.style.cssText = [
            'display: flex;',
            'justify-content: space-between;',
            'align-items: center;',
            'background: #fff;',
            'border-bottom: 1px solid var(--border, #e5e7eb);',
            'padding: 0.75rem 1rem;'
        ].join('');

        const headerTitle = document.createElement('h2');
        headerTitle.className = 'card-title';
        headerTitle.textContent = title;
        headerTitle.style.cssText = ['margin: 0;', 'font-size: 1.1rem;'].join('');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.style.cssText = [
            'background: none;',
            'border: none;',
            'font-size: 1.5rem;',
            'cursor: pointer;'
        ].join('');

        header.appendChild(headerTitle);
        header.appendChild(closeBtn);

        // Body
        const body = document.createElement('div');
        body.style.cssText = ['padding: 1.25rem;'].join('');

        const desc = document.createElement('p');
        desc.textContent = description;
        desc.style.cssText = [
            'color: var(--text-secondary, #6b7280);',
            'margin-bottom: 0.75rem;'
        ].join('');

        const textarea = document.createElement('textarea');
        textarea.className = 'form-input';
        textarea.rows = String(cfg.rows || 4);
        textarea.placeholder = placeholder;
        textarea.style.cssText = [
            'width: 100%;',
            'resize: vertical;',
            'min-height: 80px;',
            'border: 1px solid var(--border, #e5e7eb);',
            'border-radius: 4px;',
            'padding: 0.5rem 0.75rem;'
        ].join('');

        // Keep a separate error node so layout doesn't jump.
        const errorEl = document.createElement('span');
        errorEl.style.cssText = [
            'display: none;',
            'color: #B91C1C;',
            'font-size: 0.875rem;',
            'margin-top: 0.5rem;',
            'line-height: 1.2;'
        ].join('');

        const footer = document.createElement('div');
        footer.style.cssText = [
            'display: flex;',
            'gap: 0.5rem;',
            'justify-content: flex-end;',
            'margin-top: 1rem;'
        ].join('');

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-outline';
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'btn';
        confirmBtn.textContent = confirmText;
        confirmBtn.style.cssText = [
            'background: ' + confirmBg + ';',
            'color: #fff;',
            'border: none;',
            'border-radius: 4px;',
            'opacity: 0.6;',
            'cursor: not-allowed;'
        ].join('');

        const close = function(value) {
            document.removeEventListener('keydown', onKeydown);
            if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
            if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            resolve(value);
        };

        function validateAndUpdate() {
            const val = String(textarea.value || '').trim();
            const ok = !required || !!val;
            confirmBtn.disabled = !ok;
            confirmBtn.style.opacity = ok ? '1' : '0.6';
            confirmBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
            errorEl.style.display = ok ? 'none' : 'inline';
            if (!ok) errorEl.textContent = 'Reason cannot be empty.';
            return ok;
        }

        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(null);
            }
        }

        backdrop.onclick = function(e) {
            if (e.target === backdrop) close(null);
        };
        closeBtn.onclick = function() { close(null); };
        cancelBtn.onclick = function() { close(null); };

        confirmBtn.onclick = function() {
            const ok = validateAndUpdate();
            if (!ok) return;
            const val = String(textarea.value || '').trim();
            close(val);
        };

        textarea.addEventListener('input', validateAndUpdate);

        // Assemble
        header.style.borderRadius = '4px 4px 0 0';
        body.appendChild(desc);
        body.appendChild(textarea);
        body.appendChild(errorEl);
        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);
        body.appendChild(footer);
        modal.appendChild(header);
        modal.appendChild(body);

        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        textarea.value = '';
        validateAndUpdate();
        document.addEventListener('keydown', onKeydown);
        textarea.focus();
    });
};

// Verification layer for critical actions (Swiss Cheese): re-confirm + optional Approval Token for Admin
window.showVerificationWindow = function(title, message) {
    return new Promise(function(resolve) {
        const safeTitle = (title || 'Verification').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeMsg = (message || 'Re-confirm this action.').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const overlay = document.createElement('div');
        overlay.className = 'notification-window-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="notification-window-box notification-warning" style="max-width: 420px;">
                <div class="notification-window-header notification-warning">
                    <span class="notification-window-title">${safeTitle}</span>
                    <button type="button" class="notification-window-close" aria-label="Close">&times;</button>
                </div>
                <div class="notification-window-body">
                    <p style="margin-bottom: 1rem;">${safeMsg}</p>
                    <label class="form-label" for="verificationApprovalToken">Approval Token (Safe Word) <span style="color: var(--text-muted); font-weight: normal;">— Admin only, if set in Settings</span></label>
                    <input type="password" id="verificationApprovalToken" class="form-input" placeholder="Enter token" autocomplete="off" style="margin-top: 0.25rem;">
                </div>
                <div class="notification-window-footer">
                    <button type="button" class="btn btn-outline" data-verify-cancel>Cancel</button>
                    <button type="button" class="btn btn-primary" data-verify-confirm>Confirm</button>
                </div>
            </div>
        `;
        const close = function(confirmed, token) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.2s ease';
            setTimeout(function() {
                overlay.remove();
                document.removeEventListener('keydown', onKeydown);
                resolve({ confirmed: !!confirmed, approvalToken: token || '' });
            }, 200);
        };
        function onKeydown(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
        }
        overlay.querySelector('.notification-window-close').onclick = function() { close(false); };
        overlay.querySelector('[data-verify-cancel]').onclick = function() { close(false); };
        overlay.querySelector('[data-verify-confirm]').onclick = function() {
            var input = overlay.querySelector('#verificationApprovalToken');
            close(true, input ? input.value : '');
        };
        overlay.onclick = function(e) { if (e.target === overlay) close(false); };
        document.addEventListener('keydown', onKeydown);
        document.body.appendChild(overlay);
        var input = overlay.querySelector('#verificationApprovalToken');
        if (input) input.focus();
    });
};

// Confirm window box (Yes/No style)
window.showConfirmWindow = function(title, message) {
    return new Promise(function(resolve) {
        const overlay = document.createElement('div');
        overlay.className = 'notification-window-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="notification-window-box notification-warning">
                <div class="notification-window-header notification-warning">
                    <span class="notification-window-title">${title}</span>
                    <button type="button" class="notification-window-close" aria-label="Close">&times;</button>
                </div>
                <div class="notification-window-body">${message}</div>
                <div class="notification-window-footer">
                    <button type="button" class="btn btn-outline" data-confirm-no>Cancel</button>
                    <button type="button" class="btn btn-primary" data-confirm-yes>Confirm</button>
                </div>
            </div>
        `;

        const close = function(value) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.2s ease';
            setTimeout(function() {
                overlay.remove();
                document.removeEventListener('keydown', onKeydown);
                resolve(!!value);
            }, 200);
        };

        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close(false);
            }
        }

        overlay.querySelector('.notification-window-close').onclick = function() { close(false); };
        overlay.querySelector('[data-confirm-no]').onclick = function() { close(false); };
        overlay.querySelector('[data-confirm-yes]').onclick = function() { close(true); };
        overlay.onclick = function(e) { if (e.target === overlay) close(false); };
        document.addEventListener('keydown', onKeydown);

        document.body.appendChild(overlay);
        overlay.querySelector('[data-confirm-yes]').focus();
    });
};

// Enter = send/submit, Shift+Enter = paragraph break (applies to all textareas)
(function initEnterShiftEnter() {
    function handleKeydown(e) {
        const el = e.target;
        if (!el || (el.tagName !== 'TEXTAREA' && !(el.isContentEditable && el.getAttribute('contenteditable') === 'true'))) return;
        if (e.key !== 'Enter') return;

        if (e.shiftKey) {
            // Shift+Enter = new line — allow default
            return;
        }
        // Enter alone = send/submit
        e.preventDefault();
        e.stopPropagation();
        var form = el.closest('form');
        if (form) {
            try { form.requestSubmit(); } catch (err) { form.submit(); }
            return;
        }
        var container = el.closest('[data-enter-submit]');
        if (container) {
            var selector = container.getAttribute('data-enter-submit');
            var btn = selector ? (container.querySelector(selector) || document.querySelector(selector)) : container.querySelector('button.btn-primary, button.btn-success, button.btn-danger');
            if (btn) btn.click();
        }
    }
    document.addEventListener('keydown', handleKeydown, true); // capture phase
})();

// LocalStorage Data Management
window.storage = {
    get: function(key) {
        try {
            const item = localStorage.getItem('swms_' + key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            return null;
        }
    },
    set: function(key, value) {
        try {
            localStorage.setItem('swms_' + key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    },
    remove: function(key) {
        localStorage.removeItem('swms_' + key);
    },
    clear: function() {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('swms_')) {
                localStorage.removeItem(key);
            }
        });
    }
};

// Initialize mock data if not exists
function initializeMockData() {
    if (!window.storage.get('products')) {
        window.storage.set('products', [
            { id: 1, sku: 'PRD-001', name: 'Milk - Fresh Whole', category: 'Dairy', totalQty: 85, available: 70, reserved: 15, minStock: 50, status: 'warning', location: 'Aisle 3, Shelf B' },
            { id: 2, sku: 'PRD-002', name: 'Rice - Basmati 5kg', category: 'Grains', totalQty: 145, available: 145, reserved: 0, minStock: 100, status: 'success', location: 'Aisle 1, Shelf A' },
            { id: 3, sku: 'PRD-003', name: 'Bread - White Loaf', category: 'Bakery', totalQty: 60, available: 60, reserved: 0, minStock: 40, status: 'success', location: 'Aisle 2, Shelf C' },
            { id: 4, sku: 'PRD-004', name: 'Yogurt - Greek', category: 'Dairy', totalQty: 120, available: 120, reserved: 0, minStock: 80, status: 'success', location: 'Aisle 3, Shelf A' },
            { id: 5, sku: 'PRD-005', name: 'Coffee - Arabica Beans', category: 'Beverages', totalQty: 200, available: 200, reserved: 0, minStock: 150, status: 'success', location: 'Aisle 4, Shelf B' },
            { id: 6, sku: 'PRD-006', name: 'Flour - All Purpose 10kg', category: 'Grains', totalQty: 75, available: 75, reserved: 0, minStock: 100, status: 'warning', location: 'Aisle 1, Shelf D' },
            { id: 7, sku: 'PRD-007', name: 'Eggs - Large Grade A', category: 'Dairy', totalQty: 45, available: 45, reserved: 0, minStock: 60, status: 'warning', location: 'Aisle 3, Shelf C' },
            { id: 8, sku: 'PRD-008', name: 'Sugar - White Granulated', category: 'Grains', totalQty: 55, available: 55, reserved: 0, minStock: 80, status: 'warning', location: 'Aisle 1, Shelf B' },
            { id: 9, sku: 'PRD-009', name: 'Butter - Unsalted', category: 'Dairy', totalQty: 90, available: 90, reserved: 0, minStock: 70, status: 'success', location: 'Aisle 3, Shelf A' },
            { id: 10, sku: 'PRD-010', name: 'Chicken - Whole Fresh', category: 'Frozen', totalQty: 150, available: 150, reserved: 0, minStock: 100, status: 'success', location: 'Freezer A, Shelf 2' },
            { id: 11, sku: 'PRD-011', name: 'Pasta - Spaghetti 500g', category: 'Grains', totalQty: 120, available: 120, reserved: 0, minStock: 80, status: 'success', location: 'Aisle 1, Shelf C' },
            { id: 12, sku: 'PRD-012', name: 'Olive Oil - Extra Virgin', category: 'Beverages', totalQty: 95, available: 95, reserved: 0, minStock: 60, status: 'success', location: 'Aisle 4, Shelf A' },
            { id: 13, sku: 'PRD-013', name: 'Cheese - Cheddar Block', category: 'Dairy', totalQty: 65, available: 65, reserved: 0, minStock: 50, status: 'success', location: 'Aisle 3, Shelf D' },
            { id: 14, sku: 'PRD-014', name: 'Tomatoes - Fresh', category: 'Frozen', totalQty: 110, available: 110, reserved: 0, minStock: 90, status: 'success', location: 'Freezer A, Shelf 1' },
            { id: 15, sku: 'PRD-015', name: 'Onions - Yellow 5kg', category: 'Frozen', totalQty: 130, available: 130, reserved: 0, minStock: 100, status: 'success', location: 'Freezer B, Shelf 1' }
        ]);
    }
    
    if (!window.storage.get('inRecords')) {
        window.storage.set('inRecords', [
            { id: 'IN-2024-015', date: '2024-01-20', product: 'Milk - Fresh Whole', lotCode: 'LOT-2024-003', qty: 50, supplier: 'ABC Dairy Co.', user: 'John Doe' },
            { id: 'IN-2024-014', date: '2024-01-19', product: 'Rice - Basmati 5kg', lotCode: 'LOT-2024-004', qty: 100, supplier: 'Grain Distributors', user: 'Sarah Johnson' }
        ]);
    }
    
    if (!window.storage.get('outRecords')) {
        window.storage.set('outRecords', [
            { id: 'OUT-2024-025', date: '2024-01-20', product: 'Yogurt - Greek', lotCode: 'LOT-2024-006', qty: 20, recipient: 'Customer Order #1234', user: 'John Doe' },
            { id: 'OUT-2024-024', date: '2024-01-20', product: 'Rice - Basmati 5kg', lotCode: 'LOT-2024-004', qty: 25, recipient: 'Retail Store A', user: 'Sarah Johnson' }
        ]);
    }
    
    if (!window.storage.get('bookings')) {
        window.storage.set('bookings', [
            { id: 'BK-2024-001', product: 'Rice - Basmati 5kg', qty: 50, requestedBy: 'John Smith', date: '2024-01-18', neededBy: '2024-01-25', status: 'pending' },
            { id: 'BK-2024-002', product: 'Milk - Fresh Whole', qty: 30, requestedBy: 'Sarah Johnson', date: '2024-01-19', neededBy: '2024-01-22', status: 'pending' }
        ]);
    }
    
    if (!window.storage.get('alerts')) {
        window.storage.set('alerts', [
            { id: 'ALERT-001', type: 'EXPIRED', severity: 'danger', product: 'Milk - Fresh Whole', batchCode: 'LOT-2024-001', message: 'Product "Milk - Fresh Whole" (Batch #LOT-2024-001) expired on 2024-01-15', createdAt: '2024-01-15', resolved: false, resolvedAt: null, disposalRequest: null },
            { id: 'ALERT-002', type: 'NEAR_EXPIRY', severity: 'warning', product: 'Bread - White Loaf', batchCode: 'LOT-2024-003', message: '"Bread - White Loaf" (Batch #LOT-2024-003) expires in 3 days', createdAt: '2024-01-17', resolved: false, resolvedAt: null, disposalRequest: null },
            { id: 'ALERT-003', type: 'LOW_STOCK', severity: 'warning', product: 'Rice - Basmati 5kg', batchCode: null, message: '"Rice - Basmati 5kg" is below minimum stock level (Current: 45, Min: 100)', createdAt: '2024-01-18', resolved: false, resolvedAt: null, disposalRequest: null },
            { id: 'ALERT-004', type: 'NEAR_EXPIRY', severity: 'info', product: 'Yogurt - Greek', batchCode: 'LOT-2024-005', message: '"Yogurt - Greek" (Batch #LOT-2024-005) expires in 15 days', createdAt: '2024-01-19', resolved: false, resolvedAt: null, disposalRequest: null }
        ]);
    }
    
    if (!window.storage.get('disposalRequests')) {
        window.storage.set('disposalRequests', []);
    }
    
    if (!window.storage.get('notifications')) {
        window.storage.set('notifications', []);
    }
}

// Form submit loading helper - disables submit button and shows "Submitting..."
window.setFormSubmitting = function(formOrFormId, isSubmitting) {
    const form = typeof formOrFormId === 'string' ? document.getElementById(formOrFormId) : formOrFormId;
    if (!form) return;
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (isSubmitting) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = 'Submitting…';
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || btn.textContent;
        delete btn.dataset.originalText;
    }
};

// Auth guard - redirect to login if not authenticated
function requireAuth() {
    const page = (window.location.pathname || '').split('/').pop() || 'login.html';
    const publicPages = ['login.html', 'forgot-password.html', 'forgot-password'];
    const prototypeSoftAuthPages = ['inventory.html', 'issuing.html', 'receiving.html', 'issuedRecords.html', 'receivedRecords.html'];
    if (publicPages.includes(page) || page === '') return;
    const token = getAuthToken();
    if (!token) {
        if (prototypeSoftAuthPages.includes(page)) {
            // Prototype mode: allow opening these pages with local fallback data.
            return;
        }
        const base = window.location.pathname.includes('/prototypes/') ? '' : '../';
        window.location.replace((base || '') + 'login.html' + (window.location.search || ''));
    }
}

// Load system settings; Warehouses link always shown (locations from api/warehouses, no global toggle)
window.updateNavFromSettings = function() {
    const warehousesLink = document.getElementById('warehousesLink');
    if (!warehousesLink) return;
    const token = getAuthToken();
    if (!token) return;
    warehousesLink.style.display = 'block';
};

// Profile dropdown (Google-style: avatar, name, account settings, logout)
window.toggleProfileDropdown = function(event) {
    event.stopPropagation();
    const dd = document.getElementById('profileDropdown');
    const btn = document.getElementById('profileAvatarBtn');
    if (!dd || !btn) return;
    const isOpen = dd.style.display === 'block';
    dd.style.display = isOpen ? 'none' : 'block';
    btn.setAttribute('aria-expanded', !isOpen);
    if (!isOpen) {
        const close = function(e) {
            if (!dd.contains(e.target) && e.target !== btn) {
                dd.style.display = 'none';
                btn.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', close);
            }
        };
        setTimeout(function() { document.addEventListener('click', close); }, 0);
    }
};

function initProfileDropdown() {
    const nameEl = document.getElementById('profileUserName');
    const emailEl = document.getElementById('profileUserEmail');
    const initialEl = document.getElementById('profileAvatarInitial');
    const avatarBtn = document.getElementById('profileAvatarBtn');
    const settingsItem = document.getElementById('profileSettingsItem');
    const userName = sessionStorage.getItem('userName') || 'User';
    const userEmail = sessionStorage.getItem('userEmail') || '';
    const userRole = sessionStorage.getItem('userRole') || 'Admin';
    const isAdmin = userRole === 'Admin' || userRole === 'ADMIN';
    if (nameEl) nameEl.textContent = userName;
    if (emailEl) emailEl.textContent = userEmail || 'No email';
    if (initialEl) initialEl.textContent = (userName.charAt(0) || 'U').toUpperCase();
    try {
        const uid = (sessionStorage.getItem('userId') || '').trim();
        const em = (sessionStorage.getItem('userEmail') || '').trim().toLowerCase();
        const key = uid ? ('swms_profile_avatar_user_' + uid) : (em ? ('swms_profile_avatar_email_' + em) : 'swms_profile_avatar_default');
        const avatarData = localStorage.getItem(key) || '';
        if (avatarBtn && avatarData) {
            avatarBtn.style.backgroundImage = 'url("' + avatarData.replace(/"/g, '%22') + '")';
            avatarBtn.style.backgroundSize = 'cover';
            avatarBtn.style.backgroundPosition = 'center';
            if (initialEl) initialEl.style.display = 'none';
        } else if (avatarBtn) {
            avatarBtn.style.backgroundImage = '';
            if (initialEl) initialEl.style.display = '';
        }
    } catch (e) {}
    if (settingsItem) settingsItem.style.display = isAdmin ? '' : 'none';
}

// Add skip-to-content link for accessibility (when main content exists)
function addSkipLink() {
    if (document.getElementById('skip-to-content')) return;
    const main = document.querySelector('main, .container, [role="main"]');
    if (!main) return;
    main.id = main.id || 'main-content';
    const skip = document.createElement('a');
    skip.href = '#' + main.id;
    skip.id = 'skip-to-content';
    skip.className = 'skip-link';
    skip.textContent = 'Skip to main content';
    skip.style.cssText = 'position:absolute;left:-9999px;z-index:9999;padding:1rem 1.5rem;background:var(--primary-color);color:white;text-decoration:none;border-radius:0.25rem;';
    skip.addEventListener('focus', () => { skip.style.left = '1rem'; skip.style.top = '1rem'; });
    skip.addEventListener('blur', () => { skip.style.left = '-9999px'; });
    document.body.insertBefore(skip, document.body.firstChild);
}

// Navigation active state
document.addEventListener('DOMContentLoaded', function() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons({ attrs: { 'stroke-width': 1.5 } });
    }
    addSkipLink();
    requireAuth();
    initializeMockData();
    if (typeof updateNavFromSettings === 'function') updateNavFromSettings();
    
    // Set active nav link based on current page
    const path = window.location.pathname.split('/').pop() || '';
    const basePage = (path || 'login.html').replace(/[?#].*/, '');
    const navLinks = document.querySelectorAll('.nav-links a');
    const receivePages = ['receiving.html', 'receivedRecords.html'];
    const issuePages = ['issuing.html', 'issuedRecords.html'];
    const hash = (window.location.hash || '').slice(1);
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        const href = link.getAttribute('href') || '';
        const hrefBase = href.replace(/[?#].*/, '');
        let isMatch = hrefBase === basePage || (basePage === '' && href === 'login.html') ||
            (hrefBase === 'receiving.html' && receivePages.includes(basePage)) ||
            (hrefBase === 'issuing.html' && issuePages.includes(basePage)) ||
            ((hrefBase === 'dashboard.html' || hrefBase === 'staff-dashboard.html') && (basePage === 'dashboard.html' || basePage === 'staff-dashboard.html'));
        if (href.includes('#purchasing')) {
            isMatch = basePage === 'inventory.html' && hash === 'purchasing';
        } else if (hrefBase === 'inventory.html' && basePage === 'inventory.html') {
            isMatch = hash !== 'purchasing';
        }
        if (isMatch) link.classList.add('active');
    });

    // Get user role from session - show Admin-only vs Staff-only nav links
    // Admin: Dashboard, Inventory, Alert, Reports, User, Supplier, Audit Log, Settings
    // Staff: Dashboard, Inventory, Alert, Reports, Supplier (Account settings in profile dropdown)
    const userRole = sessionStorage.getItem('userRole') || 'Admin';
    const isAdmin = userRole === 'Admin' || userRole === 'ADMIN';
    const usersLink = document.getElementById('usersLink');
    const auditLink = document.getElementById('auditLink');
    const settingsLink = document.getElementById('settingsLink');
    const approvalCenterLink = document.getElementById('approvalCenterLink');
    const altApprovalLink = document.getElementById('disposalApprovalsLink'); // legacy id used on dashboard.html
    const myAccountLink = document.getElementById('myAccountLink');
    if (usersLink) usersLink.style.display = isAdmin ? '' : 'none';
    if (auditLink) auditLink.style.display = isAdmin ? '' : 'none';
    if (settingsLink) settingsLink.style.display = isAdmin ? '' : 'none';
    if (approvalCenterLink) approvalCenterLink.style.display = isAdmin ? '' : 'none';
    if (altApprovalLink) altApprovalLink.style.display = isAdmin ? '' : 'none';
    // My Account hidden from nav for all - Account settings available in profile dropdown
    if (myAccountLink) myAccountLink.style.display = 'none';

    // Both Admin and Staff use dashboard.html (role-based content shown/hidden on the page)

    // Init profile dropdown (avatar, user name, account settings, logout)
    initProfileDropdown();

    // Mock data functions for prototypes
    window.mockData = {
        currentUser: {
            name: 'John Doe',
            role: userRole
        }
    };

    // Format dates
    window.formatDate = function(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    // Format datetime
    window.formatDateTime = function(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Show/hide elements based on role (for prototype)
    window.isAdmin = function() {
        return window.mockData.currentUser.role === 'Admin';
    };

    // Enhanced form validation
    window.validateForm = function(formId) {
        const form = document.getElementById(formId);
        if (!form) return false;

        const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;
        const errors = [];

        inputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                input.style.borderColor = 'var(--danger-color)';
                errors.push(`${input.previousElementSibling?.textContent || 'Field'} is required`);
            } else {
                input.style.borderColor = 'var(--border-color)';
                
                // Additional validation
                if (input.type === 'email' && !input.value.includes('@')) {
                    isValid = false;
                    input.style.borderColor = 'var(--danger-color)';
                    errors.push('Invalid email format');
                }
                if (input.type === 'number' && parseFloat(input.value) < 0) {
                    isValid = false;
                    input.style.borderColor = 'var(--danger-color)';
                    errors.push('Quantity must be positive');
                }
            }
        });

        if (!isValid && errors.length > 0) {
            showNotification(errors[0], 'error');
        }

        return isValid;
    };

    // Debounce function for search
    window.debounce = function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };

    // Logout function - clear session and redirect to login
    window.handleLogout = function(event) {
        if (event) {
            event.preventDefault();
        }
        console.log('Logging out...');
        
        // Clear session storage (authentication data)
        sessionStorage.removeItem('authToken');
        try { localStorage.removeItem('authToken'); } catch (e) {}
        sessionStorage.removeItem('refreshToken');
        sessionStorage.removeItem('userRole');
        sessionStorage.removeItem('userId');
        sessionStorage.removeItem('userName');
        sessionStorage.removeItem('userEmail');
        
        // Optionally clear remember me (or keep it for next login)
        // localStorage.removeItem('rememberMe');
        // localStorage.removeItem('savedEmail');
        
        console.log('Session cleared, redirecting to login...');
        
        // Redirect to login page
        const currentPath = window.location.pathname;
        let loginPath;
        
        if (currentPath.includes('/prototypes/')) {
            loginPath = 'login.html'; // Relative path
        } else {
            loginPath = '/prototypes/login.html'; // Absolute path
        }
        
        window.location.href = loginPath;
    };

    console.log('SWMS Prototype Loaded');
});

// ============================================
// Zoom and Scroll Position Restoration
// Ensures consistent zoom level and scroll position across all pages
// ============================================

(function() {
    'use strict';
    
    // Prevent auto-scroll to top immediately
    let scrollRestored = false;
    let scrollSaveInterval = null;
    
    // Get current page name for storing page-specific scroll positions
    function getPageName() {
        const path = window.location.pathname;
        const page = path.split('/').pop() || 'login.html';
        return page.replace('.html', '');
    }
    
    // Save and restore scroll position
    function initScrollRestoration() {
        const pageName = getPageName();
        const scrollKey = 'swms_scroll_' + pageName;
        let savedScrollPosition = sessionStorage.getItem(scrollKey);
        
        // Prevent any automatic scrolling before we restore position
        if (savedScrollPosition && parseInt(savedScrollPosition) > 0) {
            // Immediately prevent scroll to top
            window.scrollTo(0, parseInt(savedScrollPosition));
            
            // Restore scroll position after page loads (in case content shifts)
            window.addEventListener('load', function() {
                setTimeout(function() {
                    const pos = parseInt(savedScrollPosition);
                    if (pos > 0 && !scrollRestored) {
                        window.scrollTo(0, pos);
                        scrollRestored = true;
                    }
                }, 50);
            });
            
            // Also restore after DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    setTimeout(function() {
                        const pos = parseInt(savedScrollPosition);
                        if (pos > 0 && !scrollRestored) {
                            window.scrollTo(0, pos);
                            scrollRestored = true;
                        }
                    }, 50);
                });
            } else {
                setTimeout(function() {
                    const pos = parseInt(savedScrollPosition);
                    if (pos > 0 && !scrollRestored) {
                        window.scrollTo(0, pos);
                        scrollRestored = true;
                    }
                }, 50);
            }
        }
        
        // Save scroll position before page unload
        window.addEventListener('beforeunload', function() {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
            sessionStorage.setItem(scrollKey, currentScroll.toString());
        });
        
        // Save scroll position periodically (but not too frequently)
        scrollSaveInterval = setInterval(function() {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
            sessionStorage.setItem(scrollKey, currentScroll.toString());
        }, 1000);
        
        // Clear interval on page unload
        window.addEventListener('beforeunload', function() {
            if (scrollSaveInterval) {
                clearInterval(scrollSaveInterval);
            }
        });
        
        // Prevent hash-based scrolling that might cause auto-scroll
        if (window.location.hash && window.location.hash !== '#') {
            // Clear hash but preserve scroll position
            window.history.replaceState(null, null, window.location.pathname + window.location.search);
        }
    }
    
    // ============================================
    // Consistent Zoom Level Across All Pages
    // Ensures the same zoom level is maintained when navigating between pages
    // ============================================
    
    function getBrowserZoomLevel() {
        // Detect browser zoom level using screen dimensions
        // This gives us the actual zoom percentage (e.g., 1.0 = 100%, 1.5 = 150%)
        if (window.outerWidth && window.innerWidth && window.innerWidth > 0) {
            return window.outerWidth / window.innerWidth;
        }
        // Fallback: use device pixel ratio (less accurate but works as fallback)
        return window.devicePixelRatio || 1;
    }
    
    // Track the CSS zoom we applied (for calculating effective zoom)
    let appliedCssZoom = 1.0;
    
    function applyZoomLevel(zoomLevel) {
        // Apply CSS zoom to match the browser zoom level
        // This ensures consistency across all pages
        if (!document.body) return;

        // Guard against corrupted/huge stored values causing "sudden massive zoom".
        // CSS `zoom` isn't standardized, so keep it within a safe range.
        if (!Number.isFinite(zoomLevel)) return;
        var clampedZoom = Math.max(0.5, Math.min(2.0, zoomLevel));
        
        // Remove existing zoom style if any
        let zoomStyle = document.getElementById('swms-zoom-style');
        if (!zoomStyle) {
            zoomStyle = document.createElement('style');
            zoomStyle.id = 'swms-zoom-style';
            document.head.appendChild(zoomStyle);
        }
        
        // Apply zoom to body element
        zoomStyle.textContent = `body { zoom: ${clampedZoom}; }`;
        appliedCssZoom = clampedZoom;
    }
    
    function saveZoomLevel(zoomLevel) {
        // Save zoom level to localStorage so it persists across pages
        localStorage.setItem('swms_zoomLevel', zoomLevel.toString());
    }
    
    function restoreZoomLevel() {
        // Get saved zoom level
        const savedZoom = localStorage.getItem('swms_zoomLevel');
        const currentBrowserZoom = getBrowserZoomLevel();
        
        if (savedZoom) {
            const targetZoom = parseFloat(savedZoom);
            // If the stored value is corrupted or extreme, ignore it and reset.
            if (!Number.isFinite(targetZoom) || targetZoom < 0.5 || targetZoom > 2.0) {
                try { localStorage.removeItem('swms_zoomLevel'); } catch (e) {}
                applyZoomLevel(1.0);
                return;
            }
            
            // Calculate the CSS zoom needed to achieve the target visual zoom
            // If browser is at 100% (1.0) and we want 150% (1.5), apply CSS zoom of 1.5
            // If browser is at 150% (1.5) and we want 150% (1.5), apply CSS zoom of 1.0
            // Formula: CSS zoom = targetZoom / currentBrowserZoom
            const cssZoomNeeded = targetZoom / currentBrowserZoom;
            
            // Apply CSS zoom to achieve the target visual zoom level
            applyZoomLevel(cssZoomNeeded);
        } else {
            // No saved zoom - save current effective zoom and apply CSS zoom of 1.0 (normal)
            // Effective zoom = browser zoom * CSS zoom
            // Since we start with no CSS zoom, effective = browser zoom
            saveZoomLevel(currentBrowserZoom);
            // Apply CSS zoom of 1.0 to maintain current browser zoom
            applyZoomLevel(1.0);
        }
    }
    
    function initZoomConsistency() {
        let lastDetectedZoom = getBrowserZoomLevel();
        
        // Function to detect and save zoom changes
        function detectZoomChange() {
            const currentBrowserZoom = getBrowserZoomLevel();
            
            // Calculate effective zoom (browser zoom * CSS zoom we applied)
            const effectiveZoom = currentBrowserZoom * appliedCssZoom;
            
            // If browser zoom changed significantly, it means user manually zoomed
            if (Math.abs(currentBrowserZoom - lastDetectedZoom) > 0.01) {
                lastDetectedZoom = currentBrowserZoom;
                // Save the effective zoom level the user wants
                saveZoomLevel(effectiveZoom);
                // Reset CSS zoom since browser zoom changed (user is controlling via browser)
                applyZoomLevel(1.0);
            } else {
                // Browser zoom didn't change, but we might have applied CSS zoom
                // Save the current effective zoom to keep it consistent
                saveZoomLevel(effectiveZoom);
            }
        }
        
        // Monitor for zoom changes
        window.addEventListener('resize', function() {
            // Debounce to avoid too many calls
            clearTimeout(window.zoomCheckTimeout);
            window.zoomCheckTimeout = setTimeout(detectZoomChange, 100);
        });
        
        // Use visualViewport API if available (better for zoom detection)
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function() {
                clearTimeout(window.zoomCheckTimeout);
                window.zoomCheckTimeout = setTimeout(detectZoomChange, 100);
            });
        }
        
        // Save zoom on page unload (save effective zoom, not just browser zoom)
        window.addEventListener('beforeunload', function() {
            const currentBrowserZoom = getBrowserZoomLevel();
            const effectiveZoom = currentBrowserZoom * appliedCssZoom;
            saveZoomLevel(effectiveZoom);
        });
        
        // Restore zoom on page load
        function doRestore() {
            restoreZoomLevel();
        }
        
        // Initialize zoom immediately if body exists, otherwise wait for DOM
        if (document.body) {
            doRestore();
        }
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', doRestore);
        } else {
            doRestore();
        }
        
        window.addEventListener('load', function() {
            setTimeout(doRestore, 50);
        });
        
        // Periodically check and maintain zoom consistency
        setInterval(function() {
            const savedZoom = localStorage.getItem('swms_zoomLevel');
            if (savedZoom) {
                const targetZoom = parseFloat(savedZoom);
                const currentBrowserZoom = getBrowserZoomLevel();
                const currentEffectiveZoom = currentBrowserZoom * appliedCssZoom;
                
                // If effective zoom differs from target, adjust CSS zoom
                if (Math.abs(currentEffectiveZoom - targetZoom) > 0.02) {
                    const cssZoomNeeded = targetZoom / currentBrowserZoom;
                    applyZoomLevel(cssZoomNeeded);
                }
            }
        }, 1000); // Check every second
    }
    
    // Initialize zoom consistency
    initZoomConsistency();
    
    // Also restore zoom when page becomes visible (e.g., when navigating back to tab)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            // Restore zoom when page becomes visible
            setTimeout(function() {
                const savedZoom = localStorage.getItem('swms_zoomLevel');
                if (savedZoom) {
                    restoreZoomLevel();
                }
            }, 100);
        }
    });
    
    // Initialize scroll restoration
    initScrollRestoration();
    
    console.log('SWMS Zoom Consistency and Scroll Restoration initialized');
})();

