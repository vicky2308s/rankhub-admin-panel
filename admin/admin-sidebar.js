// Centralized Sidebar and Top Header Component for RankHub Admin Panel
import { ICONS } from './admin.js';
import { initUniversalBulkActions } from './admin-bulk-actions.js';

// Profile display is intentionally minimal for the direct-access admin console.
function getCurrentAdminProfile() {
    return {
    name: 'Admin',
    role: 'Admin Console'
    };
}

// Define the official navigation items in required sequence
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: './admin-dashboard.html', icon: ICONS.dashboard },
  { id: 'users', label: 'Users', href: './admin-users.html', icon: ICONS.users },
  { id: 'exams', label: 'Exams', href: './admin-exams.html', icon: ICONS.exams },
  { id: 'subjects', label: 'Subjects', href: './admin-subjects.html', icon: ICONS.subjects },
  { id: 'mock-tests', label: 'Mock Tests', href: './admin-mock-tests.html', icon: ICONS.mock_tests },
  { id: 'live-tests', label: 'Live Tests', href: './live-tests.html', icon: ICONS.mock_tests },
  { id: 'pyq', label: 'PYQ', href: './admin-pyq.html', icon: ICONS.pyq },
  { id: 'test-series', label: 'Test Series', href: './admin-test-series.html', icon: ICONS.test_series },
  { id: 'topics', label: 'Topics', href: './admin-topics.html', icon: ICONS.topics },
  { id: 'questions', label: 'Questions', href: './admin-questions.html', icon: ICONS.questions },
  { id: 'results', label: 'Results', href: './admin-results.html', icon: ICONS.results },
  { id: 'notes', label: 'Notes', href: './admin-notes.html', icon: ICONS.notes },
  { id: 'current-affairs', label: 'Current Affairs', href: './admin-current-affairs.html', icon: ICONS.current_affairs },
  { id: 'notifications', label: 'Notifications', href: './admin-notifications.html', icon: ICONS.notifications },
  { id: 'settings', label: 'Settings', href: './admin-settings.html', icon: ICONS.settings }
];

/**
 * Initializes and injects the common Sidebar and Header into the current page
 * @param {string} activePageId - identifier matching current page (e.g. 'dashboard', 'users', 'exams')
 * @param {string} pageTitle - Title shown in top header breadcrumb
 */
export function initAdminLayout(activePageId, pageTitle = '') {
  // 1. Inject or update Sidebar
  let sidebarEl = document.getElementById('admin-common-sidebar');
  if (!sidebarEl) {
    sidebarEl = document.createElement('aside');
    sidebarEl.id = 'admin-common-sidebar';
    sidebarEl.className = 'admin-sidebar';
    document.body.prepend(sidebarEl);
  }

  // 2. Inject Mobile Overlay
  let overlayEl = document.getElementById('sidebar-backdrop-overlay');
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.id = 'sidebar-backdrop-overlay';
    overlayEl.className = 'sidebar-overlay';
    document.body.appendChild(overlayEl);
  }

  // Generate Nav HTML
  const navHtml = NAV_ITEMS.map(item => {
    const isActive = item.id === activePageId || window.location.pathname.includes(item.href.replace('./', ''));
    return `
      <a href="${item.href}" class="nav-item ${isActive ? 'active' : ''}" id="nav-item-${item.id}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `;
  }).join('');

  const admin = getCurrentAdminProfile();

  sidebarEl.innerHTML = `
    <div class="sidebar-header">
      <a href="./admin-dashboard.html" class="brand-logo">
        <div class="brand-icon">R</div>
        <div class="brand-text">
          <div class="brand-title">Rank<span>Hub</span></div>
          <span class="brand-badge">ADMIN CONSOLE</span>
        </div>
      </a>
      <button type="button" class="sidebar-close-btn" id="btn-sidebar-close" aria-label="Close navigation">&#10005;</button>
    </div>

    <div class="sidebar-nav">
      <div class="nav-section-title">Core Management</div>
      ${navHtml}
    </div>

    <div class="sidebar-footer">
      <div class="user-profile-widget" style="justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
          <div class="user-avatar" id="admin-avatar">${(admin.name || 'A').charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name" id="admin-user-name">${admin.name || 'Super Admin'}</div>
            <div class="user-role" id="admin-user-role">Active Session</div>
          </div>
        </div>
      </div>
      <button type="button" class="btn btn-secondary" id="btn-admin-logout" style="width:100%; margin-top:10px;">Sign Out</button>
    </div>
  `;

  // 3. Inject or enhance Header
  const headerContainer = document.querySelector('.admin-header');
  if (headerContainer && !headerContainer.hasAttribute('data-initialized')) {
    headerContainer.setAttribute('data-initialized', 'true');
    const displayTitle = pageTitle || NAV_ITEMS.find(n => n.id === activePageId)?.label || 'Console';

    headerContainer.innerHTML = `
      <div class="header-left">
        <button type="button" class="mobile-menu-btn" id="btn-mobile-toggle" aria-label="Toggle Navigation">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div>
          <div class="page-breadcrumb">
            <a href="./admin-dashboard.html">Admin</a>
            <span>/</span>
            <span>${displayTitle}</span>
          </div>
          <h2 class="page-title-main">${displayTitle}</h2>
        </div>
      </div>
      <div class="header-right">
        <div class="header-search">
          <span class="header-search-icon">${ICONS.search}</span>
          <input type="text" placeholder="Global search..." id="global-admin-search" />
        </div>
        <a href="./admin-notifications.html" class="header-action-btn" title="Notifications">
          ${ICONS.notifications}
          <span class="indicator-dot"></span>
        </a>
        <a href="./admin-settings.html" class="header-action-btn" title="Platform Settings">
          ${ICONS.settings}
        </a>
      </div>
    `;
  }

  // 4. Mobile Drawer event handlers
  const closeSidebar = () => {
    sidebarEl.classList.remove('open');
    overlayEl.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  };

  const openSidebar = () => {
    sidebarEl.classList.add('open');
    overlayEl.classList.add('active');
    document.body.classList.add('sidebar-open');
  };

  const mobileBtn = document.getElementById('btn-mobile-toggle');
  if (mobileBtn) {
    mobileBtn.onclick = () => {
      if (sidebarEl.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    };
  }

  document.getElementById('btn-sidebar-close')?.addEventListener('click', closeSidebar);

  sidebarEl.querySelectorAll('.nav-item').forEach((navItem) => {
    navItem.onclick = () => {
      if (window.innerWidth <= 768) {
        closeSidebar();
      }
    };
  });

  overlayEl.onclick = closeSidebar;

  document.getElementById('btn-admin-logout')?.addEventListener('click', async () => {
    const logoutButton = document.getElementById('btn-admin-logout');
    logoutButton.disabled = true;
    const configuredApiBaseUrl = typeof globalThis.RANKHUB_API_BASE_URL === 'string'
      ? globalThis.RANKHUB_API_BASE_URL.trim()
      : '';
    const apiBaseUrl = (configuredApiBaseUrl || window.location.origin).replace(/\/+$/, '');

    try {
      await fetch(`${apiBaseUrl}/api/admin/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } finally {
      window.location.replace('./admin-login.html');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });

  initUniversalBulkActions();
}