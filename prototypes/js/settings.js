/**
 * Settings page - Control Center (unified layout like inventory.html)
 * GET /api/settings to load, PUT /api/settings to save (bulk).
 */
(function() {
    const API_BASE = typeof window.getSwmsApiBase === 'function' ? window.getSwmsApiBase() : (window.API_BASE_URL || window.API_BASE || 'http://localhost:3000/api');
    const getAuthHeaders = window.getAuthHeaders || function() {
        var token = '';
        try {
            if (typeof window.getAuthToken === 'function') {
                token = window.getAuthToken() || '';
            } else {
                var s = sessionStorage.getItem('authToken');
                var l = '';
                try { l = localStorage.getItem('authToken') || ''; } catch (e) {}
                token = (s && String(s).trim()) ? String(s).trim() : ((l && String(l).trim()) ? String(l).trim() : '');
            }
        } catch (e) {
            token = sessionStorage.getItem('authToken') || '';
        }
        const h = { 'Content-Type': 'application/json' };
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    };

    const DEFAULTS = {
        timezone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        systemCurrency: 'USD',
        sessionTimeoutMinutes: '1440',
        emailNotificationsEnabled: '1',
        browserNotificationsEnabled: '0',
        browserSoundOnAlert: '0',
        nearExpiryDays: '7',
        approvalSafeWord: ''
    };

    function getAvatarStorageKey() {
        var uid = '';
        var email = '';
        try {
            uid = (sessionStorage.getItem('userId') || '').trim();
            email = (sessionStorage.getItem('userEmail') || '').trim().toLowerCase();
        } catch (e) {}
        if (uid) return 'swms_profile_avatar_user_' + uid;
        if (email) return 'swms_profile_avatar_email_' + email;
        return 'swms_profile_avatar_default';
    }

    function loadStoredAvatarDataUrl() {
        try { return localStorage.getItem(getAvatarStorageKey()) || ''; } catch (e) { return ''; }
    }

    function saveStoredAvatarDataUrl(dataUrl) {
        try {
            localStorage.setItem(getAvatarStorageKey(), dataUrl || '');
        } catch (e) {
            showToast('Avatar image is too large to save. Try a smaller image.', 'error');
            return false;
        }
        return true;
    }

    function applyIdentityAvatar(nameText) {
        var imgEl = document.getElementById('settingsProfileAvatarImage');
        var initialEl = document.getElementById('settingsProfileAvatarInitial');
        if (!imgEl || !initialEl) return;
        var dataUrl = loadStoredAvatarDataUrl();
        if (dataUrl) {
            imgEl.src = dataUrl;
            imgEl.style.display = 'block';
            initialEl.style.display = 'none';
        } else {
            imgEl.removeAttribute('src');
            imgEl.style.display = 'none';
            initialEl.style.display = 'inline';
            initialEl.textContent = (String(nameText || 'A').charAt(0) || 'A').toUpperCase();
        }
    }

    function showToast(message, type) {
        if (typeof window.showNotification === 'function') {
            window.showNotification('Settings', message, type || 'success');
        } else {
            alert(message);
        }
    }

    function showSettingsTab(tabName) {
        switchSettingsTab(tabName);
    }
    function switchSettingsTab(tabId) {
        // Normalize: 4 tabs are account, system, inventory, security-notifications
        if (tabId === 'general') tabId = 'system';
        if (tabId === 'notifications' || tabId === 'security') tabId = 'security-notifications';
        document.querySelectorAll('.top-tab.settings-tab').forEach(function(btn) {
            var dataTab = btn.getAttribute('data-tab');
            btn.classList.toggle('active', dataTab === tabId);
            btn.setAttribute('aria-selected', dataTab === tabId ? 'true' : 'false');
        });
        var securityGroupIds = ['panel-access-security', 'panel-notification-preferences', 'panel-high-authorization'];
        document.querySelectorAll('.settings-panel').forEach(function(panel) {
            var show = false;
            if (tabId === 'security-notifications') {
                show = securityGroupIds.indexOf(panel.id) >= 0;
            } else {
                show = panel.id === 'panel-' + tabId;
            }
            panel.classList.toggle('active', show);
        });
        if (tabId === 'account' && document.getElementById('panel-account')) {
            loadAccountData();
        }
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons({ attrs: { 'stroke-width': 1.5 } });
    }

    function getFormPayload() {
        const num = function(id) {
            const el = document.getElementById(id);
            const v = el && el.value !== '' ? parseInt(el.value, 10) : null;
            return v;
        };
        const str = function(id, def) {
            const el = document.getElementById(id);
            return (el && el.value !== undefined) ? String(el.value).trim() : (def !== undefined ? def : '');
        };
        const sessionMinutes = num('setting-sessionTimeoutMinutes');
        const nearExpiry = num('setting-nearExpiryDays');
        var emailEl = document.getElementById('setting-emailNotificationsEnabled');
        var browserEl = document.getElementById('setting-browserNotificationsEnabled');
        var soundEl = document.getElementById('setting-browserSoundOnAlert');
        return {
            timezone: str('setting-timezone', 'UTC'),
            dateFormat: str('setting-dateFormat', 'YYYY-MM-DD'),
            systemCurrency: str('setting-systemCurrency', 'USD'),
            sessionTimeoutMinutes: sessionMinutes != null && !isNaN(sessionMinutes) ? String(Math.max(5, Math.min(1440, sessionMinutes))) : '1440',
            emailNotificationsEnabled: emailEl && emailEl.checked ? '1' : '0',
            browserNotificationsEnabled: browserEl && browserEl.checked ? '1' : '0',
            browserSoundOnAlert: soundEl && soundEl.checked ? '1' : '0',
            nearExpiryDays: nearExpiry != null && !isNaN(nearExpiry) ? String(Math.max(1, Math.min(365, nearExpiry))) : '7'
        };
    }

    function populateReportingCurrencySelect(preserveCode) {
        var sel = document.getElementById('setting-systemCurrency');
        if (!sel) return;
        var list = typeof window !== 'undefined' && window.REPORTING_CURRENCIES ? window.REPORTING_CURRENCIES : [];
        if (!list.length) {
            sel.innerHTML = '';
            var fb = document.createElement('option');
            fb.value = 'USD';
            fb.textContent = 'USD — United States dollar';
            sel.appendChild(fb);
            return;
        }
        var preserve =
            preserveCode != null && String(preserveCode).trim()
                ? String(preserveCode).trim().toUpperCase()
                : String(sel.value || '').trim().toUpperCase();
        sel.innerHTML = '';
        list.forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c.code;
            opt.textContent = c.code + ' — ' + c.name;
            sel.appendChild(opt);
        });
        if (preserve && Array.from(sel.options).some(function (o) { return o.value === preserve; })) {
            sel.value = preserve;
        }
    }

    function ensureCurrencyOptionExists(code) {
        var sel = document.getElementById('setting-systemCurrency');
        if (!sel || !code) return;
        var c = String(code).trim().toUpperCase();
        if (!c || Array.from(sel.options).some(function (o) { return o.value === c; })) return;
        var opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c + ' (saved value)';
        sel.insertBefore(opt, sel.firstChild);
        sel.value = c;
    }

    function setFormFromData(data) {
        data = data || {};
        const set = function(id, value) {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === 'checkbox') {
                el.checked = value === '1' || value === true;
            } else {
                el.value = value != null ? value : '';
            }
        };
        set('setting-timezone', data.timezone || 'UTC');
        set('setting-dateFormat', data.dateFormat || 'YYYY-MM-DD');
        var curCode = (data.systemCurrency || 'USD').toString().trim().toUpperCase() || 'USD';
        populateReportingCurrencySelect(curCode);
        ensureCurrencyOptionExists(curCode);
        set('setting-systemCurrency', curCode);
        set('setting-sessionTimeoutMinutes', data.sessionTimeoutMinutes || '1440');
        set('setting-emailNotificationsEnabled', data.emailNotificationsEnabled);
        set('setting-browserNotificationsEnabled', data.browserNotificationsEnabled);
        set('setting-browserSoundOnAlert', data.browserSoundOnAlert);
        set('setting-nearExpiryDays', data.nearExpiryDays || '7');
        var tokenEnabledCb = document.getElementById('setting-approvalTokenEnabled');
        if (tokenEnabledCb) tokenEnabledCb.checked = !!data.approvalSafeWordSet;
        var openBtn = document.getElementById('settingsApprovalTokenOpenBtn');
        var tokenMsg = document.getElementById('settingsApprovalTokenMessage');
        if (openBtn) openBtn.style.display = (tokenEnabledCb && tokenEnabledCb.checked) ? '' : 'none';
        if (tokenMsg) {
            var enabled = !!(tokenEnabledCb && tokenEnabledCb.checked);
            tokenMsg.textContent = enabled ? 'Administrative safe word is on.' : 'Administrative safe word is off.';
            tokenMsg.style.color = enabled ? 'var(--success, #15803d)' : 'var(--text-secondary, #6b7280)';
        }
    }

    function setFormFromDefaults() {
        setFormFromData(DEFAULTS);
    }

    async function loadSettings() {
        var loadingEl = document.getElementById('settingsLoading');
        var panelsWrap = document.getElementById('settingsPanelsWrap');
        if (loadingEl) loadingEl.style.display = 'block';
        if (panelsWrap) panelsWrap.style.display = 'none';
        try {
            const r = await fetch(API_BASE + '/settings', { headers: getAuthHeaders() });
            const j = await r.json();
            if (loadingEl) loadingEl.style.display = 'none';
            if (panelsWrap) panelsWrap.style.display = '';
            if (j.success && j.data) {
                setFormFromData(j.data);
                const statusEl = document.getElementById('emailConfigStatus');
                if (statusEl) {
                    statusEl.textContent = j.data.emailConfigured
                        ? 'SMTP is configured. Emails can be sent when enabled.'
                        : 'SMTP not configured. Set SMTP_USER and SMTP_PASS in backend .env.';
                }
            } else {
                setFormFromData(DEFAULTS);
            }
        } catch (e) {
            console.error('Load settings:', e);
            if (loadingEl) loadingEl.style.display = 'none';
            if (panelsWrap) panelsWrap.style.display = '';
            setFormFromData(DEFAULTS);
            showToast('Failed to load settings. Check if backend is running.', 'error');
        }
    }

    async function saveSettings() {
        const btn = document.getElementById('settingsSaveBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = ' Saving...';
        }
        try {
            const payload = getFormPayload();
            const r = await fetch(API_BASE + '/settings', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });
            const j = await r.json();
            if (r.ok && j.success) {
                showToast('Settings updated successfully.', 'success');
                if (j.data) setFormFromData(j.data);
            } else {
                showToast(j.error || j.message || 'Failed to save settings', 'error');
            }
        } catch (e) {
            console.error('Save settings:', e);
            showToast('Failed to save. Check network and backend.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="check" style="width: 16px; height: 16px;"></i> Save Changes';
                if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons({ attrs: { 'stroke-width': 1.5 } });
            }
        }
    }

    function resetToDefault() {
        setFormFromDefaults();
        showToast('Form reset to defaults. Click Save Changes to apply.', 'success');
    }

    function requestBrowserNotificationPermission() {
        const cb = document.getElementById('setting-browserNotificationsEnabled');
        if (!cb || !cb.checked) return;
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    function settingsInit() {
        populateReportingCurrencySelect('USD');
        loadSettings();
        if (document.getElementById('panel-account')) loadAccountData();

        // Single-page mode: show all settings sections (no subpage/tab switching).
        document.querySelectorAll('.settings-panel').forEach(function(panel) {
            panel.classList.add('active');
        });

        var saveBtn = document.getElementById('settingsSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', function() {
            saveSettings();
            requestBrowserNotificationPermission();
        });

        var accountForm = document.getElementById('settingsAccountForm');
        if (accountForm) accountForm.addEventListener('submit', function(e) { e.preventDefault(); saveSettings(); });

        var browserNotif = document.getElementById('setting-browserNotificationsEnabled');
        if (browserNotif) browserNotif.addEventListener('change', requestBrowserNotificationPermission);

        // Password update is handled by the "Change Password" modal.
        wirePasswordModal();
        wireApprovalTokenControls();
        wireProfileAvatarUpload();
    }

    function wireApprovalTokenControls() {
        var enabledCb = document.getElementById('setting-approvalTokenEnabled');
        var openBtn = document.getElementById('settingsApprovalTokenOpenBtn');
        var msgEl = document.getElementById('settingsApprovalTokenMessage');
        var modal = document.getElementById('settingsApprovalTokenModal');
        var modalCloseBtn = document.getElementById('settingsApprovalTokenModalCloseBtn');
        var modalCancelBtn = document.getElementById('settingsApprovalTokenCancelBtn');
        var modalConfirmBtn = document.getElementById('settingsApprovalTokenConfirmBtn');
        var modalMsg = document.getElementById('settingsApprovalTokenModalMessage');

        if (!enabledCb || !openBtn || !modal || !modalCloseBtn || !modalCancelBtn || !modalConfirmBtn || !modalMsg) return;

        function updateUi() {
            var enabled = !!enabledCb.checked;
            openBtn.style.display = enabled ? '' : 'none';
            if (msgEl) {
                msgEl.textContent = enabled ? 'Administrative safe word is on.' : 'Administrative safe word is off.';
                msgEl.style.color = enabled ? 'var(--success, #15803d)' : 'var(--text-secondary, #6b7280)';
            }
        }

        function openModal(mode) {
            modal.dataset.mode = mode || 'set';
            modalMsg.textContent = '';
            modalMsg.style.color = 'var(--danger, #b91c1c)';
            var cur = document.getElementById('setting-currentApprovalToken');
            var np = document.getElementById('setting-newApprovalToken');
            var cp = document.getElementById('setting-confirmApprovalToken');
            if (cur) cur.value = '';
            if (np) np.value = '';
            if (cp) cp.value = '';
            // For disable flow, hide new/confirm fields.
            var curWrap = cur && cur.closest('.form-group');
            var newWrap = np && np.closest('.form-group');
            var confWrap = cp && cp.closest('.form-group');
            var isDisable = mode === 'disable';
            var requireCurrent = enabledCb.checked || isDisable;
            modal.dataset.requireCurrent = requireCurrent ? '1' : '0';
            if (curWrap) curWrap.style.display = requireCurrent ? '' : 'none';
            if (newWrap) newWrap.style.display = isDisable ? 'none' : '';
            if (confWrap) confWrap.style.display = isDisable ? 'none' : '';
            modalConfirmBtn.textContent = isDisable ? 'Turn off safe word' : 'Save safe word';
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
            try { setTimeout(function() { if (cur) cur.focus(); }, 0); } catch (e) {}
        }

        function closeModal() {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
        }

        async function submitModal() {
            var mode = modal.dataset.mode || 'set';
            var cur = document.getElementById('setting-currentApprovalToken');
            var np = document.getElementById('setting-newApprovalToken');
            var cp = document.getElementById('setting-confirmApprovalToken');
            var currentToken = cur ? String(cur.value || '').trim() : '';
            var newToken = np ? String(np.value || '').trim() : '';
            var confirmToken = cp ? String(cp.value || '').trim() : '';
            var enabled = mode !== 'disable';
            var requireCurrent = modal.dataset.requireCurrent === '1';

            if (!enabled && requireCurrent && !currentToken) {
                modalMsg.textContent = 'Enter your current safe word to turn it off.';
                return;
            }
            if (enabled) {
                if (requireCurrent && !currentToken) {
                    modalMsg.textContent = 'Enter your current safe word to change it.';
                    return;
                }
                if (!newToken || !confirmToken) {
                    modalMsg.textContent = 'Enter and confirm the new safe word.';
                    return;
                }
                if (newToken !== confirmToken) {
                    modalMsg.textContent = 'New safe word and confirmation do not match.';
                    return;
                }
            }

            modalConfirmBtn.disabled = true;
            try {
                var requestBody = {
                    enabled: enabled,
                    currentToken: currentToken,
                    newToken: newToken,
                    confirmToken: confirmToken
                };
                var r;
                if (typeof window.fetchWithAuth === 'function') {
                    r = await window.fetchWithAuth(API_BASE + '/settings/approval-token', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });
                } else {
                    r = await fetch(API_BASE + '/settings/approval-token', {
                        method: 'PUT',
                        headers: getAuthHeaders(),
                        body: JSON.stringify(requestBody)
                    });
                }
                var j = await r.json().catch(function() { return {}; });
                if (r.ok && j.success) {
                    enabledCb.checked = !!(j.data && j.data.approvalSafeWordSet);
                    updateUi();
                    closeModal();
                    showToast(j.message || 'Administrative safe word updated.', 'success');
                } else {
                    if (r.status === 401) {
                        modalMsg.textContent = 'Session expired. Please log in again.';
                        return;
                    }
                    modalMsg.textContent = j.error || j.message || 'Could not update administrative safe word.';
                }
            } catch (e) {
                modalMsg.textContent = 'Network error. Try again.';
            } finally {
                modalConfirmBtn.disabled = false;
            }
        }

        enabledCb.addEventListener('change', function () {
            // Changing state requires verification; revert checkbox until modal succeeds.
            var targetEnable = !!enabledCb.checked;
            enabledCb.checked = !targetEnable;
            openModal(targetEnable ? 'set' : 'disable');
        });
        openBtn.addEventListener('click', function () { openModal('set'); });
        modalCloseBtn.addEventListener('click', closeModal);
        modalCancelBtn.addEventListener('click', closeModal);
        modalConfirmBtn.addEventListener('click', submitModal);
        modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

        updateUi();
    }

    function wireProfileAvatarUpload() {
        var avatarWrap = document.querySelector('.settings-avatar');
        var fileInput = document.getElementById('settingsProfileAvatarInput');
        if (!avatarWrap || !fileInput) return;

        avatarWrap.title = 'Click to change profile image';
        avatarWrap.addEventListener('click', function () {
            try { fileInput.click(); } catch (e) {}
        });

        fileInput.addEventListener('change', function (ev) {
            var file = ev && ev.target && ev.target.files && ev.target.files[0] ? ev.target.files[0] : null;
            if (!file) return;
            if (!file.type || file.type.indexOf('image/') !== 0) {
                showToast('Please choose an image file.', 'error');
                fileInput.value = '';
                return;
            }
            // Keep localStorage usage bounded.
            if (file.size > 1024 * 1024 * 2) {
                showToast('Image is too large. Please choose an image smaller than 2MB.', 'error');
                fileInput.value = '';
                return;
            }

            var reader = new FileReader();
            reader.onload = function () {
                var dataUrl = String(reader.result || '');
                if (!dataUrl) return;
                if (!saveStoredAvatarDataUrl(dataUrl)) return;
                var nameText = '';
                try { nameText = (document.getElementById('settingsProfileName') || {}).textContent || ''; } catch (e) {}
                applyIdentityAvatar(nameText || 'A');
                // Also update top-right avatar in current page immediately when available.
                try {
                    var topInitial = document.getElementById('profileAvatarInitial');
                    var topBtn = document.getElementById('profileAvatarBtn');
                    if (topBtn) {
                        topBtn.style.backgroundImage = 'url("' + dataUrl.replace(/"/g, '%22') + '")';
                        topBtn.style.backgroundSize = 'cover';
                        topBtn.style.backgroundPosition = 'center';
                    }
                    if (topInitial) topInitial.style.display = 'none';
                } catch (e) {}
                showToast('Profile image updated.', 'success');
            };
            reader.onerror = function () {
                showToast('Unable to read selected image.', 'error');
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });
    }

    async function loadAccountData() {
        var panel = document.getElementById('panel-account');
        if (!panel) return;
        var nameEl = document.getElementById('settingsProfileName');
        var emailEl = document.getElementById('settingsProfileEmail');
        var avatarEl = document.getElementById('settingsProfileAvatarInitial');
        if (!nameEl || !emailEl) return;
        var userId = sessionStorage.getItem('userId');
        if (!userId) {
            var n0 = sessionStorage.getItem('userName') || '';
            var e0 = sessionStorage.getItem('userEmail') || '';
            nameEl.textContent = n0 || 'Admin';
            emailEl.textContent = e0 || '';
            if (avatarEl) avatarEl.textContent = (String(n0 || 'A').charAt(0) || 'A').toUpperCase();
            applyIdentityAvatar(n0 || 'A');
            return;
        }
        try {
            var r = await fetch(API_BASE + '/users/' + userId, { headers: getAuthHeaders() });
            var j = await r.json().catch(function() { return {}; });
            if (r.ok && j.success && j.data) {
                var n = j.data.name != null ? j.data.name : '';
                var e = j.data.email != null ? j.data.email : '';
                nameEl.textContent = n || 'Admin';
                emailEl.textContent = e || '';
                if (avatarEl) avatarEl.textContent = (String(n || 'A').charAt(0) || 'A').toUpperCase();
                applyIdentityAvatar(n || 'A');
            } else {
                var n1 = sessionStorage.getItem('userName') || '';
                var e1 = sessionStorage.getItem('userEmail') || '';
                nameEl.textContent = n1 || 'Admin';
                emailEl.textContent = e1 || '';
                if (avatarEl) avatarEl.textContent = (String(n1 || 'A').charAt(0) || 'A').toUpperCase();
                applyIdentityAvatar(n1 || 'A');
            }
        } catch (e) {
            var n2 = sessionStorage.getItem('userName') || '';
            var e2 = sessionStorage.getItem('userEmail') || '';
            nameEl.textContent = n2 || 'Admin';
            emailEl.textContent = e2 || '';
            if (avatarEl) avatarEl.textContent = (String(n2 || 'A').charAt(0) || 'A').toUpperCase();
            applyIdentityAvatar(n2 || 'A');
        }
    }

    async function saveAccountFromSettings(silent) {
        var userId = sessionStorage.getItem('userId');
        if (!userId) {
            if (!silent) showToast('Please log in again.', 'error');
            return;
        }
        var nameEl = document.getElementById('setting-accountName');
        var emailEl = document.getElementById('setting-accountEmail');
        var msgEl = document.getElementById('settingsAccountMessage');
        var btn = null;
        if (!nameEl || !emailEl || !msgEl) return;
        var name = (nameEl.value || '').trim();
        var email = (emailEl.value || '').trim();
        if (!name) {
            msgEl.textContent = 'Name is required.';
            msgEl.style.color = 'var(--danger, #b91c1c)';
            return;
        }
        if (!email) email = sessionStorage.getItem('userEmail') || '';
        msgEl.textContent = '';
        if (btn) { btn.disabled = true; btn.innerHTML = ' Saving...'; }
        try {
            var body = { name: name, email: email };
            var r = await fetch(API_BASE + '/users/me', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(body)
            });
            var j = await r.json().catch(function() { return {}; });
            if (r.ok && j.success) {
                sessionStorage.setItem('userName', name);
                sessionStorage.setItem('userEmail', email);
                msgEl.textContent = 'Account updated successfully.';
                msgEl.style.color = 'var(--success, #15803d)';
                if (!silent) showToast('Account updated successfully.', 'success');
            } else {
                msgEl.textContent = j.error || j.message || 'Failed to update account.';
                msgEl.style.color = 'var(--danger, #b91c1c)';
            }
        } catch (e) {
            msgEl.textContent = 'Network error. Try again.';
            msgEl.style.color = 'var(--danger, #b91c1c)';
        } finally {}
    }

    function validateNewPasswordFormat(pwd) {
        var p = String(pwd || '');
        if (!p) return 'New password is required.';
        if (p.length < 8) return 'New password must be at least 8 characters.';
        if (p.length > 64) return 'New password must be 64 characters or fewer.';
        if (/\s/.test(p)) return 'New password must not contain spaces.';
        if (!/[A-Z]/.test(p)) return 'Include at least one uppercase letter (A-Z).';
        if (!/[a-z]/.test(p)) return 'Include at least one lowercase letter (a-z).';
        if (!/[0-9]/.test(p)) return 'Include at least one number (0-9).';
        if (!/[^A-Za-z0-9]/.test(p)) return 'Include at least one symbol (e.g. !@#$).';
        return '';
    }

    function wirePasswordModal() {
        const openBtn = document.getElementById('settingsChangePasswordOpenBtn');
        const modal = document.getElementById('settingsPwModal');
        const closeBtn = document.getElementById('settingsPwModalCloseBtn');
        const cancelBtn = document.getElementById('settingsPwCancelBtn');
        const confirmBtn = document.getElementById('settingsPwConfirmBtn');
        if (!openBtn || !modal || !closeBtn || !cancelBtn || !confirmBtn) return;

        function openModal() {
            const msgEl = document.getElementById('settingsPasswordMessage');
            if (msgEl) {
                msgEl.textContent = '';
                msgEl.style.color = 'var(--danger, #b91c1c)';
            }
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
            try {
                setTimeout(function () {
                    const cur = document.getElementById('setting-currentPassword');
                    if (cur) cur.focus();
                }, 0);
            } catch (e) {}
        }

        function closeModal() {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            try {
                const cur = document.getElementById('setting-currentPassword');
                const np = document.getElementById('setting-newPassword');
                const cf = document.getElementById('setting-confirmPassword');
                if (cur) cur.value = '';
                if (np) np.value = '';
                if (cf) cf.value = '';
                const msgEl = document.getElementById('settingsPasswordMessage');
                if (msgEl) msgEl.textContent = '';
            } catch (e) {}
        }

        openBtn.addEventListener('click', openModal);
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeModal();
        });

        confirmBtn.addEventListener('click', function () {
            changePassword();
        });

        document.addEventListener('keydown', function (e) {
            if (modal.style.display !== 'flex') return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal();
            }
        });
    }

    async function changePassword() {
        var current = document.getElementById('setting-currentPassword');
        var newP = document.getElementById('setting-newPassword');
        var confirmP = document.getElementById('setting-confirmPassword');
        var msgEl = document.getElementById('settingsPasswordMessage');
        var btn = document.getElementById('settingsPwConfirmBtn');
        if (!current || !newP || !confirmP || !msgEl) return;

        var curVal = (current.value || '').trim();
        var newVal = (newP.value || '').trim();
        var confVal = (confirmP.value || '').trim();

        msgEl.textContent = '';
        msgEl.style.color = 'var(--danger, #b91c1c)';

        if (!curVal) {
            msgEl.textContent = 'Enter your current password.';
            return;
        }

        var policyErr = validateNewPasswordFormat(newVal);
        if (policyErr) {
            msgEl.textContent = policyErr;
            return;
        }

        if (newVal !== confVal) {
            msgEl.textContent = 'New password and confirmation do not match.';
            return;
        }

        if (newVal === curVal) {
            msgEl.textContent = 'New password must be different from your current password.';
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = 'Updating...';
        }

        try {
            var r = await fetch(API_BASE + '/users/me/password', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ currentPassword: curVal, newPassword: newVal })
            });
            var j = await r.json().catch(function () { return {}; });

            if (r.ok && j.success) {
                msgEl.textContent = 'Password updated successfully.';
                msgEl.style.color = 'var(--success, #15803d)';
                showToast('Password updated successfully.', 'success');
                // Close + clear modal after success.
                try {
                    var modal = document.getElementById('settingsPwModal');
                    if (modal) {
                        modal.style.display = 'none';
                        modal.setAttribute('aria-hidden', 'true');
                    }
                } catch (e) {}

                current.value = '';
                newP.value = '';
                confirmP.value = '';
                msgEl.textContent = '';
            } else {
                // Backend message includes "Current password is incorrect" when the password is wrong.
                msgEl.textContent = j.error || j.message || 'Failed to update password.';
                msgEl.style.color = 'var(--danger, #b91c1c)';
            }
        } catch (e) {
            msgEl.textContent = 'Network error. Try again.';
            msgEl.style.color = 'var(--danger, #b91c1c)';
        } finally {
            if (btn) {
                btn.disabled = false;
                if (btn.dataset.originalText) {
                    btn.textContent = btn.dataset.originalText;
                    delete btn.dataset.originalText;
                }
                if (typeof lucide !== 'undefined' && lucide.createIcons) {
                    try { lucide.createIcons({ attrs: { 'stroke-width': 1.5 } }); } catch (e) {}
                }
            }
        }
    }

    window.settingsInit = settingsInit;
    window.settingsLoad = loadSettings;
    window.showSettingsTab = showSettingsTab;
    window.fetchSettings = loadSettings;
    window.saveAccountFromSettings = saveAccountFromSettings;
    window.loadAccountData = loadAccountData;
})();
