// workspace-fullscreen.js - Full screen mode for VED plan review workspace
(() => {
  'use strict';

  function initFullscreen() {
    const docEl = document.documentElement;
    const body = document.body;
    const grid = document.querySelector('.grid');
    const headerBtn = document.getElementById('btn-fullscreen');
    const canvasBtn = document.getElementById('canvas-fullscreen-btn');
    const pagebarBtn = document.getElementById('pagebar-fullscreen-btn');
    const sidebarToggleBtn = document.getElementById('btn-toggle-sidebar');

    function isFullscreenActive() {
      return Boolean(document.fullscreenElement || docEl.classList.contains('workspace-fullscreen'));
    }

    function updateUI(active) {
      const label = active ? 'Exit full screen' : 'Full screen';
      const title = active ? 'Exit full screen mode (Shift+F / Esc)' : 'Full screen mode (Shift+F / F11)';

      if (headerBtn) {
        headerBtn.textContent = label;
        headerBtn.title = title;
        headerBtn.setAttribute('aria-pressed', String(active));
      }
      if (canvasBtn) {
        canvasBtn.textContent = label;
        canvasBtn.title = title;
        canvasBtn.setAttribute('aria-pressed', String(active));
      }
      if (pagebarBtn) {
        pagebarBtn.textContent = label;
        pagebarBtn.title = title;
        pagebarBtn.setAttribute('aria-pressed', String(active));
      }

      if (sidebarToggleBtn) {
        sidebarToggleBtn.hidden = !active;
      }
    }

    function syncCanvas() {
      // Dispatch resize event to trigger existing resizeStage listener in review.js
      window.dispatchEvent(new Event('resize'));
    }

    function enterFullscreen() {
      docEl.classList.add('workspace-fullscreen');
      body.classList.add('workspace-fullscreen');
      updateUI(true);

      if (docEl.requestFullscreen && !document.fullscreenElement) {
        docEl.requestFullscreen().catch(() => {
          // Graceful fallback: CSS full-window mode remains active if browser rejects API request
        });
      }

      setTimeout(syncCanvas, 50);
      setTimeout(syncCanvas, 180);

      const statusEl = document.getElementById('editor-status');
      if (statusEl) {
        statusEl.textContent = 'Entered full screen mode. Press Shift+F, F11, or Esc to exit.';
      }
    }

    function exitFullscreen() {
      docEl.classList.remove('workspace-fullscreen');
      body.classList.remove('workspace-fullscreen');
      if (grid) grid.classList.remove('sidebar-collapsed');
      if (sidebarToggleBtn) {
        sidebarToggleBtn.textContent = 'Hide panel';
        sidebarToggleBtn.title = 'Hide sidebar panel (Ctrl+B)';
      }
      updateUI(false);

      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }

      setTimeout(syncCanvas, 50);
      setTimeout(syncCanvas, 180);

      const statusEl = document.getElementById('editor-status');
      if (statusEl) {
        statusEl.textContent = 'Exited full screen mode.';
      }
    }

    function toggleFullscreen() {
      if (isFullscreenActive()) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
    }

    function toggleSidebar() {
      if (!grid) return;
      const isCollapsed = grid.classList.toggle('sidebar-collapsed');
      if (sidebarToggleBtn) {
        sidebarToggleBtn.textContent = isCollapsed ? 'Show panel' : 'Hide panel';
        sidebarToggleBtn.title = isCollapsed ? 'Show sidebar panel (Ctrl+B)' : 'Hide sidebar panel (Ctrl+B)';
      }
      setTimeout(syncCanvas, 50);
    }

    // Attach button listeners
    if (headerBtn) {
      headerBtn.addEventListener('click', toggleFullscreen);
    }
    if (canvasBtn) {
      canvasBtn.addEventListener('click', toggleFullscreen);
    }
    if (pagebarBtn) {
      pagebarBtn.addEventListener('click', toggleFullscreen);
    }
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }

    // Browser fullscreen change event synchronization
    function onFullscreenChange() {
      const hasFs = Boolean(document.fullscreenElement);
      if (!hasFs && docEl.classList.contains('workspace-fullscreen')) {
        exitFullscreen();
      } else if (hasFs && !docEl.classList.contains('workspace-fullscreen')) {
        enterFullscreen();
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // Keyboard shortcut listeners
    window.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;

      // Shift+F or F11 toggles fullscreen
      if ((e.shiftKey && e.key.toLowerCase() === 'f') || e.key === 'F11') {
        if (!isInput) {
          e.preventDefault();
          toggleFullscreen();
        }
      }
      // Escape exits fullscreen if in CSS full-window mode
      else if (e.key === 'Escape' && isFullscreenActive()) {
        if (!document.fullscreenElement) {
          exitFullscreen();
        }
      }
      // Ctrl+B toggles sidebar in fullscreen mode
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        if (!isInput && isFullscreenActive()) {
          e.preventDefault();
          toggleSidebar();
        }
      }
    });

    // Expose API on window for programmatic control and testing
    window.workspaceFullscreen = {
      toggle: toggleFullscreen,
      enter: enterFullscreen,
      exit: exitFullscreen,
      isActive: isFullscreenActive,
      toggleSidebar
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFullscreen);
  } else {
    initFullscreen();
  }
})();
