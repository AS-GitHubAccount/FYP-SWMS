/**
 * SWMS shell: flat light sidebar (classic layout), role-based items, desktop collapse.
 * Mounts into #sidebar after DOM ready.
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

        if (base === 'inventory' || base === 'compare' || base === 'purchasing-history') {
            return 'nav-inventory';
        }
        if (base === 'dashboard' || base === 'staff-dashboard') return 'nav-dashboard';
        if (base === 'warehouses') return 'nav-warehouses';
        if (base === 'suppliers') return 'nav-suppliers';
        if (base === 'alerts') return 'nav-alerts';
        if (base === 'approval') return 'nav-approval';
        if (base === 'users') return 'nav-users';
        if (base === 'reports') return 'nav-reports';
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

    function buildSidebarHtml(admin) {
        var parts = [];

        parts.push(
            '<div class="sidebar-brand-row">' +
                '<a href="dashboard.html" class="logo sidebar-logo" title="Smart Warehouse Management System">' +
                '<span class="sidebar-logo-text">SWMS</span>' +
                '<span class="sidebar-logo-mark" aria-hidden="true">S</span>' +
                '</a>' +
                '<button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Collapse sidebar" title="Collapse">' +
                icon('panel-left-close') +
                '</button></div>'
        );

        var main =
            link('dashboard.html', 'layout-dashboard', 'Dashboard', 'nav-dashboard') +
            link('inventory.html', 'package', 'Inventory', 'nav-inventory') +
            link('alerts.html', 'bell', 'Alerts', 'nav-alerts') +
            link('reports.html', 'bar-chart-3', 'Reports', 'nav-reports');

        if (admin) {
            main += link('users.html', 'user', 'Users', 'nav-users');
        }

        main +=
            link('suppliers.html', 'truck', 'Suppliers', 'nav-suppliers') +
            link('warehouses.html', 'warehouse', 'Warehouses', 'nav-warehouses');

        if (admin) {
            main += link('approval.html', 'shield-check', 'Approval', 'nav-approval');
        }

        parts.push(
            '<div class="sidebar-scroll">' +
                '<nav class="sidebar-nav sidebar-nav--flat" aria-label="Main">' +
                main +
                '</nav></div>'
        );
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
