import { bulkDeleteFirestoreRecords } from './admin-db.js';
import { showConfirmDialog, showToast } from './admin.js';

const RESOURCE_BY_PAGE = {
  'admin-users.html': 'users',
  'admin-exams.html': 'exams',
  'admin-subjects.html': 'subjects',
  'admin-topics.html': 'topics',
  'admin-questions.html': 'questions',
  'admin-test-series.html': 'test-series',
  'admin-mock-tests.html': 'mock-tests',
  'live-tests.html': 'live-tests',
  'admin-results.html': 'results',
  'admin-notes.html': 'notes',
  'admin-pyq.html': 'pyqs',
  'admin-current-affairs.html': 'current-affairs',
  'admin-notifications.html': 'notifications'
};

let universalBulkActionsInitialized = false;

function getRowId(row) {
  const deleteButton = row.querySelector(
    '.delete, [data-delete-question], [data-action="delete"]'
  );

  return deleteButton?.dataset.id ||
    deleteButton?.dataset.deleteQuestion ||
    '';
}

function getTables() {
  return Array.from(document.querySelectorAll('table')).filter(table =>
    Array.from(table.querySelectorAll('tbody tr')).some(row => getRowId(row))
  );
}

export function initUniversalBulkActions() {
  const resource = RESOURCE_BY_PAGE[window.location.pathname.split('/').pop()];
  if (!resource) return;

  if (universalBulkActionsInitialized) return;
  universalBulkActionsInitialized = true;

  const selectedIds = new Set();
  const deletedIds = new Set();
  let isDeleting = false;

  const clearSelection = () => {
    selectedIds.clear();
    sync();
  };

  const getRows = () => getTables().flatMap(table =>
    Array.from(table.querySelectorAll('tbody tr'))
      .map(row => ({ row, id: getRowId(row) }))
      .filter(item => item.id)
  );

  const sync = () => {
    document.querySelectorAll('[data-bulk-row-checkbox]').forEach(input => {
      input.checked = selectedIds.has(input.dataset.id);
    });

    document.querySelectorAll('[data-bulk-count]').forEach(element => {
      element.textContent = `${selectedIds.size} Selected`;
    });

    document.querySelectorAll('[data-bulk-delete]').forEach(button => {
      button.disabled = selectedIds.size === 0 || isDeleting;
    });

    document.querySelectorAll('[data-bulk-select-all]').forEach(input => {
      const visibleIds = getRows().map(item => item.id);
      const selectedVisible = visibleIds.filter(id => selectedIds.has(id));
      input.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      input.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    });
  };

  const confirmDelete = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || isDeleting) return;

    showConfirmDialog({
      title: 'Delete Selected Items?',
      message: `You are about to delete ${ids.length} item${ids.length === 1 ? '' : 's'}. This action cannot be undone.`,
      confirmText: 'Delete',
      isDanger: true,
      onConfirm: async () => {
        isDeleting = true;
        sync();
        try {
          const result = await bulkDeleteFirestoreRecords(resource, ids);
          if (!result?.success) {
            throw new Error(result?.error || 'Bulk delete failed.');
          }

          const deletedRecordIds = new Set(result.deletedIds || []);
          deletedRecordIds.forEach(id => deletedIds.add(id));
          selectedIds.forEach(id => {
            if (deletedRecordIds.has(id)) selectedIds.delete(id);
          });

          if (deletedRecordIds.size) {
            showToast(`${deletedRecordIds.size} item${deletedRecordIds.size === 1 ? '' : 's'} deleted successfully.`);
          }

          if ((result.failedIds || []).length) {
            showToast('Some items could not be deleted.', 'error');
          }

          getRows().forEach(({ row, id }) => {
            if (deletedRecordIds.has(id)) row.remove();
          });

          window.dispatchEvent(new CustomEvent('rankhub:bulk-delete-complete', {
            detail: { resource, deletedIds: Array.from(deletedRecordIds), failedIds: result.failedIds || [] }
          }));

        } catch (error) {
          console.error(`Bulk delete failed for ${resource}:`, error);
          showToast(error?.message || 'Some items could not be deleted.', 'error');
        } finally {
          isDeleting = false;
          sync();
        }
      }
    });
  };

  let observer;

  const render = () => {
    if (observer) observer.disconnect();

    try {
      getTables().forEach(table => {
        const rows = Array.from(table.querySelectorAll('tbody tr'))
          .map(row => ({ row, id: getRowId(row) }))
          .filter(item => item.id);
        if (!rows.length) return;

        rows.forEach(({ row, id }) => {
          if (deletedIds.has(id)) row.remove();
        });

        const remainingRows = Array.from(table.querySelectorAll('tbody tr'))
          .map(row => ({ row, id: getRowId(row) }))
          .filter(item => item.id);
        if (!remainingRows.length) return;

        const headerRow = table.querySelector('thead tr');
        if (headerRow && !headerRow.querySelector('[data-bulk-select-all]')) {
          const headerCell = document.createElement('th');
          headerCell.className = 'bulk-checkbox-cell';
          headerCell.innerHTML = '<input type="checkbox" data-bulk-select-all aria-label="Select all visible items">';
          headerRow.prepend(headerCell);
        }

        remainingRows.forEach(({ row, id }) => {
          if (row.querySelector('[data-bulk-row-checkbox]')) return;
          const cell = document.createElement('td');
          cell.className = 'bulk-checkbox-cell';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.dataset.bulkRowCheckbox = '';
          input.dataset.id = id;
          input.setAttribute('aria-label', 'Select item');
          cell.appendChild(input);
          row.prepend(cell);
        });

        const container = table.parentElement;
        if (container && !container.querySelector(':scope > .bulk-toolbar')) {
          const toolbar = document.createElement('div');
          toolbar.className = 'bulk-toolbar';
          toolbar.innerHTML = `
            <label class="bulk-select-all-label">
              <input type="checkbox" data-bulk-select-all aria-label="Select all visible items">
              <span>Select All</span>
            </label>
            <span class="bulk-count" data-bulk-count>0 Selected</span>
            <button type="button" class="btn btn-danger bulk-delete-button" data-bulk-delete disabled>Delete Selected</button>
          `;
          container.prepend(toolbar);
        }
      });
      sync();
    } finally {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  };

  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-bulk-row-checkbox]')) {
      if (target.checked) selectedIds.add(target.dataset.id);
      else selectedIds.delete(target.dataset.id);
      sync();
    } else if (target.matches('[data-bulk-select-all]')) {
      const visibleIds = getRows().map(item => item.id);
      visibleIds.forEach(id => target.checked ? selectedIds.add(id) : selectedIds.delete(id));
      sync();
    } else if (target.matches('input, select') && !target.closest('.bulk-toolbar')) {
      clearSelection();
    }
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-bulk-delete]')) confirmDelete();
  });

  observer = new MutationObserver(render);
  observer.observe(document.body, { childList: true, subtree: true });
  render();
}