/**
 * SWMS enterprise shell: grouped sidebar, role-based items, desktop collapse.
 * Mounts into #sidebar after DOM ready; runs after app.js (second DOMContentLoaded).
 */
(function () {
    'use strict';

    var STORAGE_COLLAPSE = 'swms_sidebar_collapsed';

    function pageFile() {
        var p = (window.location.pathname || '').split('/').pop() || '';
        return (p.split('?')[0].split('#')[0] || '').toLowerCase();
    }

    function isAdminRole() {
        var r = (sessionStorage.getItem('userRole') || 'Admin').trim();
        return r === 'Admin' || r === 'ADMIN';
    }

    function currentNavKey() {
        var file = pageFile();
        var base = file.replace(/\.html$/, '');
        var sp = new URLSearchParams(window.location.search);
        var tab = (sp.get('tab') || '').toLowerCase();
        var hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
        var t = tab || hash;

        if (base === 'inventory') {
            if (!t || t === 'inventory') return 'inv-inventory';
            return 'inv-' + t;
        }
        if (base === 'dashboard' || base === 'staff-dashboard') return 'dashboard';
        if (base === 'warehouses') return 'inv-warehouses';
        if (base === 'suppliers') return 'proc-suppliers';
        if (base === 'purchasing-history') return 'proc-history';
        if (base === 'compare') return 'proc-compare';
        if (base === 'alerts') return 'op-alerts';
        if (base === 'approval') return 'admin-approval';
        if (base === 'users') return 'admin-users';
        if (base === 'settings') return 'admin-settings';
        if (base === 'audit') return 'admin-audit';
        if (base === 'notifications') return 'workspace-inbox';
        if (base === 'reports') return 'insights-reports';
        return '';
    }

    function icon(name) {
        return '<i data-lucide="' + name + '" class="nav-icon" aria-hidden="true"></i>';
    }

    function link(href, lucideName, label, navKey, attrs) {
        attrs = attrs || '';
        return (
            '<a href="' + href + '" class="sidebar-nav-link" data-nav-key="' + navKey + '" ' + attrs + '>' +
            icon(lucideName) +
            '<span class="sidebar-nav-label">' + label + '</span></a>'
        );
    }

    function group(title, inner) {
        return (
            '<div class="sidebar-nav-group" role="group" aria-label="' + title + '">' +
            '<div class="sidebar-group-label">' + title + '</div>' +
            '<nav class="sidebar-nav">' + inner + '</nav></div>'
        );
    }

    function buildSidebarHtml(admin) {
        var parts = [];

        parts.push(
            '<div class="sidebar-brand-row">' +
            '<a href="dashboard.html" class="logo sidebar-logo" title="SWMS">' +
            '<span class="sidebar-logo-text">SWMS</span>' +
            '<span class="sidebar-logo-mark" aria-hidden="true">S</span>' +
            '</a>' +
            '<button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Collapse sidebar" title="Collapse">' +
            icon('panel-left-close') +
            '</button></div>'
        );

        parts.push(
            '<div class="sidebar-scroll">' +
            group(
                'Overview',
                link('dashboard.html', 'layout-dashboard', 'Dashboard', 'dashboard')
            )
        );

        parts.push(
            group(
                'Inventory control',
                link('inventory.html', 'package', 'Stock & catalog', 'inv-inventory') +
                    link('inventory.html?tab=booking', 'calendar-check', 'Bookings', 'inv-booking') +
                    link('warehouses.html', 'warehouse', 'Warehouses', 'inv-warehouses')
            )
        );

        parts.push(
            group(
                'Procurement',
                link('inventory.html?tab=purchasing', 'shopping-cart', 'Purchasing', 'inv-purchasing') +
                    link('compare.html', 'git-compare', 'RFQ compare', 'proc-compare') +
                    link('purchasing-history.html', 'file-text', 'Purchase requests', 'proc-history') +
                    link('suppliers.html', 'truck', 'Suppliers', 'proc-suppliers')
            )
        );

        parts.push(
            group(
                'Operations',
                link('inventory.html?tab=receiving', 'package-plus', 'Receiving', 'inv-receiving') +
                    link('inventory.html?tab=issuing', 'package-minus', 'Issuing', 'inv-issuing') +
                    link('alerts.html', 'bell', 'Alerts', 'op-alerts')
            )
        );

        if (admin) {
            parts.push(
                group(
                    'Admin & audit',
                    link('approval.html', 'shield-check', 'Approval center', 'admin-approval', 'data-admin-nav="1"') +
                        link('users.html', 'users', 'User management', 'admin-users', 'data-admin-nav="1"') +
                        link('settings.html', 'settings', 'System settings', 'admin-settings', 'data-admin-nav="1"') +
                        link('audit.html', 'scroll-text', 'Audit log', 'admin-audit', 'data-admin-nav="1"')
                )
            );
        } else {
            parts.push(
                group(
                    'Workspace',
                    link('notifications.html', 'inbox', 'Tasks & inbox', 'workspace-inbox', 'data-staff-nav="1"')
                )
            );
        }

        parts.push(
            group(
                'Insights',
                link('reports.html', 'bar-chart-2', 'Reports', 'insights-reports')
            )
        );

        parts.push('</div>');
        return parts.join('');
    }

    function applyActiveKey(key) {
        var links = document.querySelectorAll('#sidebar .sidebar-nav-link[data-nav-key]');
        for (var i = 0; i < links.length; i++) {
            links[i].classList.toggle('active', links[i].getAttribute('data-nav-key') === key);
        }
    }

    function applyCollapseFromStorage() {
        try {
            if (localStorage.getItem(STORAGE_COLLAPSE) === '1') {
                document.body.classList.add('sidebar-collapsed');
            }
        } catch (e) {}
    }

    function toggleDesktopCollapse() {
        if (window.matchMedia && window.matchMedia('(max-width: 1024px)').matches) return;
        document.body.classList.toggle('sidebar-collapsed');
        try {
            localStorage.setItem(STORAGE_COLLAPSE, document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
        } catch (e) {}
        var btn = document.getElementById('sidebarCollapseBtn');
        if (btn) {
            btn.setAttribute(
                'aria-label',
                document.body.classList.contains('sidebar-collapsed') ? 'Expand sidebar' : 'Collapse sidebar'
            );
        }
    }

    function mount() {
        var sidebar = document.getElementById('sidebar');
        if (!sidebar || sidebar.getAttribute('data-shell-skip') === '1') return;

        var admin = isAdminRole();
        sidebar.innerHTML = buildSidebarHtml(admin);

        applyCollapseFromStorage();

        var key = currentNavKey();
        if (key) applyActiveKey(key);

        var collapseBtn = document.getElementById('sidebarCollapseBtn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', function (e) {
                e.preventDefault();
                toggleDesktopCollapse();
            });
        }

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons({ attrs: { 'stroke-width': 1.5 } });
        }
    }

    window.refreshSwmsShellNav = function () {
        mount();
    };

    document.addEventListener('DOMContentLoaded', function () {
        mount();
    });
})();
