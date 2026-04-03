/**
 * Approval Center - unified pending Disposals, Bookings, Purchase Requests
 * Fetches from GET /api/all-approvals and renders one table. Uses muted ERP button styles.
 */

(function () {
    const API_BASE = (typeof window.getSwmsApiBase === 'function' ? window.getSwmsApiBase() : (window.API_BASE_URL || window.API_BASE || 'http://localhost:3000/api'));

    function getAuthHeaders() {
        const token = (typeof window.getAuthToken === 'function' ? window.getAuthToken() : sessionStorage.getItem('authToken')) || '';
        const h = { 'Content-Type': 'application/json' };
        if (token) h['Authorization'] = 'Bearer ' + token;
        return h;
    }

    function escapeHtml(str) {
        if (str == null) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function formatDate(d) {
        if (!d) return '—';
        try {
            return new Date(d).toLocaleString();
        } catch (e) {
            return String(d);
        }
    }

    function typeLabel(type) {
        if (type === 'disposal') return 'Disposal';
        if (type === 'booking') return 'Booking';
        if (type === 'purchase_request') return 'Purchase';
        if (type === 'rfq_withdrawal') return 'RFQ Withdrawal';
        return type || '—';
    }

    function typeChipHtml(type) {
        const label = typeLabel(type);
        if (type === 'disposal') {
            return `<span style="background-color:#FEE2E2; color:#991B1B; padding:2px 8px; border-radius:4px; font-weight:600;">${label}</span>`;
        }
        if (type === 'booking') {
            return `<span style="background-color:#DBEAFE; color:#1E40AF; padding:2px 8px; border-radius:4px; font-weight:600;">${label}</span>`;
        }
        if (type === 'purchase_request') {
            return `<span style="background-color:#FEF3C7; color:#92400E; padding:2px 8px; border-radius:4px; font-weight:600;">${label}</span>`;
        }
        if (type === 'rfq_withdrawal') {
            return `<span style="background-color:#F3E8FF; color:#8B5CF6; padding:2px 8px; border-radius:4px; font-weight:600;">${label}</span>`;
        }
        return escapeHtml(label);
    }

    function getCurrentFilters() {
        const statusEl = document.getElementById('approvalStatusFilter');
        const typeEl = document.getElementById('approvalTypeFilter');
        const nameEl = document.getElementById('approvalNameFilter');
        const status = statusEl ? (statusEl.value || 'all').toUpperCase() : 'ALL';
        const type = typeEl ? typeEl.value : 'all';
        const name = nameEl ? String(nameEl.value || '').trim() : '';
        return { status: status === 'ALL' ? 'all' : status, type, name };
    }

    function filterByName(list, nameTerm) {
        const term = String(nameTerm || '').toLowerCase().trim();
        if (!term) return list;
        return (list || []).filter(row => {
            const requestedBy = String(row.requestedByName || '').toLowerCase();
            const reference = String(row.reference || '').toLowerCase();
            const description = String(row.description || '').toLowerCase();
            return requestedBy.includes(term) || reference.includes(term) || description.includes(term);
        });
    }

    // Cache approvals; invalidate after approve/reject. statusParam stored to refetch when status filter changes.
    let allApprovalsCache = null;
    let lastApprovalStatusParam = null;

    async function rejectWithReason(requestType, id, reason) {
        const userId = parseInt(sessionStorage.getItem('userId') || '0', 10);
        const headers = getAuthHeaders();

        if (requestType === 'disposal') {
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/disposal-requests/' + id + '/reject', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ rejectedBy: userId, rejectReason: reason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
            if (typeof showNotification === 'function') showNotification('Disposal request rejected.', 'success');
            return;
        }

        if (requestType === 'booking') {
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/bookings/' + id + '/cancel', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ cancelledBy: userId, rejectReason: reason, reason: reason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
            if (typeof showNotification === 'function') showNotification('Booking cancelled.', 'success');
            return;
        }

        if (requestType === 'purchase_request') {
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/purchase-requests/' + id + '/reject', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ rejectedBy: userId, rejectReason: reason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
            if (typeof showNotification === 'function') showNotification('Purchase request rejected.', 'success');
            return;
        }

        // rfq_withdrawal
        const res = await (window.fetchWithAuth || fetch)(API_BASE + '/rfqs/' + id + '/reject-withdrawal', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ rejectedBy: userId, rejectReason: reason })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
        if (typeof showNotification === 'function') showNotification('RFQ withdrawal request rejected.', 'success');
        return;
    }

    // Rejection modal state
    let rejectContext = null; // { requestType, id, minLen }

    // Approval modal state (mandatory reason before executing approve)
    let approveContext = null; // { requestType, id }

    function requiredReasonMin(requestType) {
        return 1; // Reason required (non-empty), no character limit shown in UI
    }

    window.closeRejectReasonModal = function () {
        const backdrop = document.getElementById('rejectReasonModalBackdrop');
        const modal = document.getElementById('rejectReasonModal');
        if (backdrop) backdrop.style.display = 'none';
        if (modal) modal.style.display = 'none';
        rejectContext = null;
    };

    function setConfirmEnabled(confirmBtn, enabled) {
        if (!confirmBtn) return;
        confirmBtn.disabled = !enabled;
        confirmBtn.style.opacity = enabled ? '1' : '0.6';
        confirmBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    window.closeApprovalReasonModal = function () {
        const backdrop = document.getElementById('approvalReasonModalBackdrop');
        const modal = document.getElementById('approvalReasonModal');
        const textarea = document.getElementById('approvalReasonInput');
        if (backdrop) backdrop.style.display = 'none';
        if (modal) modal.style.display = 'none';
        approveContext = null;
        if (textarea) {
            textarea.value = '';
            textarea.classList.remove('approval-reason-error');
        }
    };

    window.approvalOpenApprovalReasonModal = function (requestType, id) {
        approveContext = { requestType, id };
        const backdrop = document.getElementById('approvalReasonModalBackdrop');
        const modal = document.getElementById('approvalReasonModal');
        const textarea = document.getElementById('approvalReasonInput');
        const confirmBtn = document.getElementById('approvalReasonConfirmBtn');
        if (textarea) {
            textarea.value = '';
            textarea.classList.remove('approval-reason-error');
            textarea.focus();
        }
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.6';
            confirmBtn.style.cursor = 'not-allowed';
        }
        if (backdrop) backdrop.style.display = 'block';
        if (modal) modal.style.display = 'block';
    };

    window.approvalOpenRejectReasonModal = function (requestType, id) {
        rejectContext = { requestType, id, minLen: requiredReasonMin(requestType) };

        const backdrop = document.getElementById('rejectReasonModalBackdrop');
        const modal = document.getElementById('rejectReasonModal');
        const textarea = document.getElementById('rejectReasonInput');
        const errorEl = document.getElementById('rejectReasonError');
        const confirmBtn = document.getElementById('rejectReasonConfirmBtn');

        if (textarea) {
            textarea.value = '';
            textarea.removeAttribute('minlength');
            textarea.focus();
        }
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
        if (confirmBtn) setConfirmEnabled(confirmBtn, false);

        if (backdrop) backdrop.style.display = 'block';
        if (modal) modal.style.display = 'block';
    };

    function wireRejectModal() {
        const textarea = document.getElementById('rejectReasonInput');
        const errorEl = document.getElementById('rejectReasonError');
        const confirmBtn = document.getElementById('rejectReasonConfirmBtn');

        if (!textarea || !confirmBtn) return;

        textarea.addEventListener('input', () => {
            if (!rejectContext) return;
            const val = String(textarea.value || '').trim();
            const minLen = rejectContext.minLen;

            const ok = val.length >= minLen;
            if (errorEl) {
                if (!ok) {
                    errorEl.textContent = 'Reason cannot be empty.';
                    errorEl.style.display = 'block';
                } else {
                    errorEl.textContent = '';
                    errorEl.style.display = 'none';
                }
            }
            setConfirmEnabled(confirmBtn, ok);
        });

        confirmBtn.addEventListener('click', async () => {
            if (!rejectContext) return;
            const textareaNow = document.getElementById('rejectReasonInput');
            const val = String(textareaNow ? textareaNow.value : '').trim();
            const minLen = rejectContext.minLen;

            if (!val || val.length < minLen) {
                if (typeof showNotification === 'function') showNotification('Reason required', 'Reason cannot be empty. Please fill in a reason before taking this action.', 'error');
                if (errorEl) {
                    errorEl.textContent = 'Reason cannot be empty.';
                    errorEl.style.display = 'block';
                }
                setConfirmEnabled(confirmBtn, false);
                return;
            }

            try {
                confirmBtn.disabled = true;
                setConfirmEnabled(confirmBtn, false);

                await rejectWithReason(rejectContext.requestType, rejectContext.id, val);
                window.closeRejectReasonModal();
                allApprovalsCache = null;
                (typeof window.loadAllApprovals === 'function' ? window.loadAllApprovals : loadAllApprovals)();
            } catch (e) {
                if (typeof showNotification === 'function') showNotification('Rejection failed: ' + (e.message || 'Unknown'), 'error');
                confirmBtn.disabled = false;
                setConfirmEnabled(confirmBtn, true);
            }
        });
    }

    function wireApprovalModal() {
        const textarea = document.getElementById('approvalReasonInput');
        const confirmBtn = document.getElementById('approvalReasonConfirmBtn');
        if (!textarea || !confirmBtn) return;

        textarea.addEventListener('input', () => {
            const val = String(textarea.value || '').trim();
            const valid = val.length >= 1;
            textarea.classList.remove('approval-reason-error');
            confirmBtn.disabled = !valid;
            confirmBtn.style.opacity = valid ? '1' : '0.6';
            confirmBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
        });

        confirmBtn.addEventListener('click', async () => {
            if (!approveContext) return;
            const val = String(textarea.value || '').trim();
            if (val.length < 1) {
                if (typeof showNotification === 'function') showNotification('Reason required', 'Reason cannot be empty. Please fill in a reason before taking this action.', 'error');
                textarea.classList.add('approval-reason-error');
                return;
            }
            textarea.classList.remove('approval-reason-error');
            const { requestType, id } = approveContext;
            try {
                confirmBtn.disabled = true;
                if (requestType === 'disposal') {
                    await approveDisposal(id, val);
                } else if (requestType === 'booking') {
                    await approveBooking(id, val);
                } else if (requestType === 'purchase_request') {
                    await approvePR(id, val);
                } else if (requestType === 'rfq_withdrawal') {
                    await approveRfqWithdrawal(id, val);
                }
                window.closeApprovalReasonModal();
                allApprovalsCache = null;
                (typeof window.loadAllApprovals === 'function' ? window.loadAllApprovals : loadAllApprovals)();
            } catch (e) {
                if (typeof showNotification === 'function') showNotification('Approve failed: ' + (e.message || 'Unknown'), 'error');
                confirmBtn.disabled = false;
            }
        });
    }

    async function loadAllApprovals() {
        const loading = document.getElementById('approvalsLoading');
        const table = document.getElementById('approvalsTable');
        const empty = document.getElementById('approvalsEmpty');
        const errEl = document.getElementById('approvalsError');

        const fromCache = allApprovalsCache != null;

        if (!fromCache) {
            if (loading) loading.style.display = 'block';
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'none';
            if (errEl) errEl.style.display = 'none';
        }

        try {
            const filters = getCurrentFilters();
            const statusParam = filters.status === 'all' ? 'all' : (filters.status || 'all');
            const statusChanged = lastApprovalStatusParam !== statusParam;
            if (!fromCache || statusChanged) {
                const statusForApi = statusParam === 'all' ? 'all' : String(statusParam).toLowerCase();
                const qs = new URLSearchParams({ status: statusForApi, type: 'all' }).toString();
                const url = API_BASE + '/approvals?' + qs;
                const headers = Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders());
                const res = await (window.fetchWithAuth || fetch)(url, { headers });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error((data && data.error) || (data && data.message) || 'Failed to load approvals');
                allApprovalsCache = Array.isArray(data.data) ? data.data : [];
                lastApprovalStatusParam = statusParam;
            }

            // Apply UI filters locally (instant).
            let typeFilter = String(filters.type || 'all').toLowerCase();
            if (typeFilter === 'purchase') typeFilter = 'purchase_request';

            let list = allApprovalsCache || [];
            if (typeFilter !== 'all') {
                list = list.filter(r => String(r.type || '') === typeFilter);
            }
            list = filterByName(list, filters.name);

            const countEl = document.getElementById('pendingCount');
            if (countEl) countEl.textContent = list.length;

            if (loading) loading.style.display = 'none';

            const tbody = document.getElementById('approvalsTableBody');
            if (!tbody) return;

            if (list.length === 0) {
                tbody.innerHTML = '';
                if (table) table.style.display = 'none';
                if (empty) {
                    empty.textContent = 'No approval requests found for the selected filters.';
                    empty.style.display = 'block';
                }
                if (errEl) errEl.style.display = 'none';
                return;
            }

            if (empty) empty.style.display = 'none';
            if (errEl) errEl.style.display = 'none';
            if (table) table.style.display = 'table';

            const thead = document.getElementById('approvalsTableHead');
            if (thead) {
                thead.innerHTML = '<tr><th>Type</th><th>Status</th><th>Reference</th><th>Description</th><th>Requested By</th><th>Date</th><th>Actions</th></tr>';
            }

            function statusDisplay(status) {
                const s = String(status || '').toUpperCase();
                if (s === 'APPROVED') return '<span style="color:#15803D;font-weight:600;">Approved</span>';
                if (s === 'REJECTED' || s === 'CANCELLED') return '<span style="color:#B91C1C;font-weight:600;">Rejected</span>';
                if (s === 'COMPLETED') return '<span style="color:#0369A1;font-weight:600;">Completed</span>';
                return '<span style="color:#92400E;font-weight:600;">Pending</span>';
            }

            tbody.innerHTML = list.map(row => {
                const ref = escapeHtml(row.reference || '—');
                const desc = escapeHtml(row.description || '—');
                const by = escapeHtml(row.requestedByName || '—');
                const date = formatDate(row.date);
                const canAct = row.status === 'PENDING';

                let actions = '—';
                if (canAct && row.type === 'disposal') {
                    actions = `<button type="button" class="btn btn-disposal-approve" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="window.approvalOpenApprovalReasonModal('disposal', ${row.id})" title="Approve">Approve</button>
                        <button type="button" class="btn btn-disposal-reject" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.approvalOpenRejectReasonModal('disposal', ${row.id})" title="Reject">Reject</button>`;
                } else if (canAct && row.type === 'booking') {
                    actions = `<button type="button" class="btn btn-disposal-approve" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="window.approvalOpenApprovalReasonModal('booking', ${row.id})" title="Approve">Approve</button>
                        <button type="button" class="btn btn-disposal-reject" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.approvalOpenRejectReasonModal('booking', ${row.id})" title="Reject">Reject</button>`;
                } else if (canAct && row.type === 'purchase_request') {
                    actions = `<button type="button" class="btn btn-disposal-approve" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="window.approvalOpenApprovalReasonModal('purchase_request', ${row.id})" title="Approve">Approve</button>
                        <button type="button" class="btn btn-disposal-reject" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.approvalOpenRejectReasonModal('purchase_request', ${row.id})" title="Reject">Reject</button>`;
                } else if (canAct && row.type === 'rfq_withdrawal') {
                    actions = `<button type="button" class="btn btn-disposal-approve" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin-right: 0.25rem;" onclick="window.approvalOpenApprovalReasonModal('rfq_withdrawal', ${row.id})" title="Approve withdrawal">Approve</button>
                        <button type="button" class="btn btn-disposal-reject" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;" onclick="window.approvalOpenRejectReasonModal('rfq_withdrawal', ${row.id})" title="Reject withdrawal">Reject</button>`;
                }

                return `<tr>
                    <td class="approval-type-cell approval-type-${row.type}">${escapeHtml(typeLabel(row.type))}</td>
                    <td>${statusDisplay(row.status)}</td>
                    <td>${ref}</td>
                    <td style="max-width: 280px; word-break: break-word;">${desc}</td>
                    <td>${by}</td>
                    <td>${date}</td>
                    <td>${actions}</td>
                </tr>`;
            }).join('');

            if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons({ attrs: { 'stroke-width': 1.5 } });
        } catch (err) {
            if (loading) loading.style.display = 'none';
            if (errEl) {
                errEl.textContent = err.message || 'Failed to load approvals';
                errEl.style.display = 'block';
            }
        }
    }

    async function approveDisposal(id, reason) {
        const note = (reason != null ? String(reason).trim() : '') || '';
        if (!note) throw new Error('Approval reason is required.');
        try {
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/disposal-requests/' + id + '/approve', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ approvedBy: parseInt(sessionStorage.getItem('userId') || '0', 10), reason: note, approvalReason: note })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Approve failed');
            if (typeof showNotification === 'function') showNotification('Disposal request approved.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Approve failed: ' + (e.message || 'Unknown'), 'error');
            throw e;
        }
    }

    async function rejectDisposal(id, reason) {
        try {
            const rejectReason = String(reason || '').trim();
            if (!rejectReason) throw new Error('Rejection reason is required.');
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/disposal-requests/' + id + '/reject', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ rejectedBy: parseInt(sessionStorage.getItem('userId') || '0', 10), rejectReason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
            if (typeof showNotification === 'function') showNotification('Disposal request rejected.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Reject failed: ' + (e.message || 'Unknown'), 'error');
        }
    }

    async function approveBooking(id, reason) {
        const note = (reason != null ? String(reason).trim() : '') || '';
        if (!note) throw new Error('Approval reason is required.');
        try {
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/bookings/' + id + '/approve', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ approvedBy: parseInt(sessionStorage.getItem('userId') || '0', 10), approvalReason: note, reason: note })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Approve failed');
            if (typeof showNotification === 'function') showNotification('Booking approved.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Approve failed: ' + (e.message || 'Unknown'), 'error');
            throw e;
        }
    }

    async function rejectBooking(id, reason) {
        try {
            const rejectReason = String(reason || '').trim();
            if (!rejectReason || rejectReason.length < 1) {
                throw new Error('Reason is required and cannot be empty.');
            }
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/bookings/' + id + '/cancel', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ cancelledBy: parseInt(sessionStorage.getItem('userId') || '0', 10), rejectReason, reason: rejectReason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
            if (typeof showNotification === 'function') showNotification('Booking rejected.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Reject failed: ' + (e.message || 'Unknown'), 'error');
        }
    }

    async function approveRfqWithdrawal(id, reason) {
        const note = (reason != null ? String(reason).trim() : '') || '';
        if (!note) throw new Error('Approval reason is required.');
        try {
            const body = { approvedBy: parseInt(sessionStorage.getItem('userId') || '0', 10), approvalReason: note, reason: note };
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/rfqs/' + id + '/approve-withdrawal', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Approve failed');
            if (typeof showNotification === 'function') showNotification('RFQ withdrawal approved.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Approve failed: ' + (e.message || 'Unknown'), 'error');
            throw e;
        }
    }

    async function approvePR(id, reason) {
        const note = (reason != null ? String(reason).trim() : '') || '';
        if (!note) throw new Error('Approval reason is required.');
        try {
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/purchase-requests/' + id + '/approve', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ approvedBy: parseInt(sessionStorage.getItem('userId') || '0', 10), approvalNote: note, reason: note })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Approve failed');
            if (typeof showNotification === 'function') showNotification('Purchase request approved.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Approve failed: ' + (e.message || 'Unknown'), 'error');
            throw e;
        }
    }

    async function rejectPR(id, reason) {
        try {
            const rejectReason = String(reason || '').trim();
            if (!rejectReason || rejectReason.length < 1) {
                throw new Error('Reason is required and cannot be empty.');
            }
            const res = await (window.fetchWithAuth || fetch)(API_BASE + '/purchase-requests/' + id + '/reject', {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ rejectedBy: parseInt(sessionStorage.getItem('userId') || '0', 10), rejectReason })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || 'Reject failed');
            if (typeof showNotification === 'function') showNotification('Purchase request rejected.', 'success');
            allApprovalsCache = null;
            loadAllApprovals();
        } catch (e) {
            if (typeof showNotification === 'function') showNotification('Reject failed: ' + (e.message || 'Unknown'), 'error');
        }
    }

    // Wire modals after DOM is present
    document.addEventListener('DOMContentLoaded', () => {
        wireRejectModal();
        wireApprovalModal();
        const nameInput = document.getElementById('approvalNameFilter');
        if (nameInput) {
            let t = null;
            nameInput.addEventListener('input', function () {
                clearTimeout(t);
                t = setTimeout(function () {
                    if (typeof window.loadAllApprovals === 'function') window.loadAllApprovals();
                }, 300);
            });
        }
    });

    window.loadAllApprovals = loadAllApprovals;
    window.approvalApproveDisposal = approveDisposal;
    window.approvalRejectDisposal = rejectDisposal;
    window.approvalApproveBooking = approveBooking;
    window.approvalRejectBooking = rejectBooking;
    window.approvalApprovePR = approvePR;
    window.approvalRejectPR = rejectPR;
})();
