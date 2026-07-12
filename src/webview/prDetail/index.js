(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let isReady = false;
  let currentOwner = '';
  let currentRepo = '';
  let currentActivities = [];
  let currentActivitySortOrder = 'newest-first';
  let currentHistoryTruncated = false;
  let currentHistoryIsNewest = true;

  console.log('[Forgejo Webview] Script loaded');

  // DOM Elements
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const contentEl = document.getElementById('content');

  const prTitleEl = document.getElementById('pr-title');
  const prNumberEl = document.getElementById('pr-number');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const prStatusBadge = document.getElementById('pr-status-badge');
  const prMergeabilityBadge = document.getElementById('pr-mergeability-badge');
  const authorAvatar = document.getElementById('author-avatar');
  const authorName = document.getElementById('author-name');
  const baseBranch = document.getElementById('base-branch');
  const headBranch = document.getElementById('head-branch');
  const labelsContainer = document.getElementById('labels-container');
  const assigneesContainer = document.getElementById('assignees-container');
  const milestoneContainer = document.getElementById('milestone-container');
  const editLabelsBtn = document.getElementById('edit-labels-btn');
  const editAssigneesBtn = document.getElementById('edit-assignees-btn');
  const editMilestoneBtn = document.getElementById('edit-milestone-btn');

  const checkoutBtn = document.getElementById('checkout-btn');
  const refreshBtn = document.getElementById('refresh-btn');
  const openWebBtn = document.getElementById('open-web-btn');
  const addCommentBtn = document.getElementById('add-comment-btn');
  const mergeActionsEl = document.getElementById('merge-actions');
  const mergeBtn = document.getElementById('merge-btn');
  const revertActionsEl = document.getElementById('revert-actions');
  const revertBtn = document.getElementById('revert-btn');

  const prDescriptionEl = document.getElementById('pr-description');
  const ciSection = document.getElementById('ci-section');
  const ciStatusList = document.getElementById('ci-status-list');
  const activityCountEl = document.getElementById('activity-count');
  const activityTimeline = document.getElementById('activity-timeline');
  const activitySortBtn = document.getElementById('activity-sort-btn');

  const editDescriptionBtn = document.getElementById('edit-description-btn');
  const descriptionEditor = document.getElementById('pr-description-editor');
  const descriptionTextarea = document.getElementById('description-textarea');
  const saveDescriptionBtn = document.getElementById('save-description-btn');
  const cancelDescriptionBtn = document.getElementById('cancel-description-btn');

  const commentInputContainer = document.getElementById('comment-input-container');
  const commentInput = document.getElementById('comment-input');
  const submitCommentBtn = document.getElementById('submit-comment-btn');
  const cancelCommentBtn = document.getElementById('cancel-comment-btn');

  const reviewDialog = document.getElementById('review-dialog');
  const reviewState = document.getElementById('review-state');
  const reviewBody = document.getElementById('review-body');
  const submitReviewBtn = document.getElementById('submit-review-btn');
  const cancelReviewBtn = document.getElementById('cancel-review-btn');

  const mergeDialog = document.getElementById('merge-dialog');
  const mergeStrategy = document.getElementById('merge-strategy');
  const confirmMergeBtn = document.getElementById('confirm-merge-btn');
  const cancelMergeBtn = document.getElementById('cancel-merge-btn');

  // Initialize
  function init() {
    console.log('[Forgejo Webview] Initializing...');
    setupEventListeners();
    setupMessageHandler();

    // Notify extension that webview is ready
    console.log('[Forgejo Webview] Posting ready message');
    vscode.postMessage({ type: 'ready' });
    isReady = true;
  }

  function setupEventListeners() {
    console.log('[Forgejo Webview] Setting up event listeners');

    retryBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Retry clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    copyUrlBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Copy URL clicked');
      if (currentData && currentData.pr && currentData.pr.html_url) {
        navigator.clipboard.writeText(currentData.pr.html_url);
        copyUrlBtn.textContent = '\u2713';
        setTimeout(() => {
          copyUrlBtn.textContent = '\uD83D\uDCCB';
        }, 2000);
      }
    });

    checkoutBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Checkout clicked');
      vscode.postMessage({ type: 'checkout' });
    });

    refreshBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Refresh clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    if (activitySortBtn) {
      activitySortBtn.addEventListener('click', () => {
        currentActivitySortOrder = currentActivitySortOrder === 'oldest-first' ? 'newest-first' : 'oldest-first';
        console.log('[Forgejo Webview] Activity sort toggled:', currentActivitySortOrder);
        renderActivityTimeline();
        vscode.postMessage({ type: 'setActivitySortOrder', order: currentActivitySortOrder });
      });
    }

    openWebBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Open in web clicked');
      vscode.postMessage({ type: 'openInBrowser' });
    });

    addCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Add comment clicked');
      commentInputContainer.style.display = 'block';
      commentInput.focus();
    });

    editLabelsBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Edit labels clicked');
      vscode.postMessage({ type: 'editLabels' });
    });

    editAssigneesBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Edit assignees clicked');
      vscode.postMessage({ type: 'editAssignees' });
    });

    editMilestoneBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Edit milestone clicked');
      vscode.postMessage({ type: 'editMilestone' });
    });

    if (mergeBtn) {
      mergeBtn.addEventListener('click', () => {
        console.log('[Forgejo Webview] Merge clicked');
        mergeDialog.style.display = 'block';
      });
    }

    if (revertBtn) {
      revertBtn.addEventListener('click', () => {
        console.log('[Forgejo Webview] Revert clicked');
        if (currentData && currentData.pr && currentData.pr.merge_commit_sha) {
          vscode.postMessage({ type: 'revert', commitSha: currentData.pr.merge_commit_sha });
        }
      });
    }

    editDescriptionBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Edit description clicked');
      if (currentData && currentData.pr) {
        descriptionTextarea.value = currentData.pr.body || '';
        prDescriptionEl.style.display = 'none';
        descriptionEditor.style.display = 'block';
        editDescriptionBtn.style.display = 'none';
        descriptionTextarea.focus();
      }
    });

    saveDescriptionBtn.addEventListener('click', () => {
      const body = descriptionTextarea.value;
      console.log('[Forgejo Webview] Save description clicked');
      saveDescriptionBtn.disabled = true;
      saveDescriptionBtn.textContent = 'Saving...';
      vscode.postMessage({ type: 'updateBody', body });
    });

    cancelDescriptionBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel description edit clicked');
      descriptionEditor.style.display = 'none';
      prDescriptionEl.style.display = 'block';
      editDescriptionBtn.style.display = 'inline-flex';
    });

    descriptionTextarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveDescriptionBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelDescriptionBtn.click();
      }
    });

    submitCommentBtn.addEventListener('click', () => {
      const body = commentInput.value.trim();
      console.log('[Forgejo Webview] Submit comment clicked, body length:', body.length);
      if (body) {
        // Disable button and show loading state to prevent double-submit
        submitCommentBtn.disabled = true;
        submitCommentBtn.textContent = 'Submitting...';
        vscode.postMessage({ type: 'addComment', body });
      }
    });

    cancelCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel comment clicked');
      commentInput.value = '';
      commentInputContainer.style.display = 'none';
    });

    // Keyboard shortcuts for comment input
    commentInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitCommentBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelCommentBtn.click();
      }
    });

    submitReviewBtn.addEventListener('click', () => {
      const state = reviewState.value;
      const body = reviewBody.value.trim();
      console.log('[Forgejo Webview] Submit review clicked, state:', state);
      submitReviewBtn.disabled = true;
      submitReviewBtn.textContent = 'Submitting...';
      vscode.postMessage({ type: 'addReview', state, body });
    });

    cancelReviewBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel review clicked');
      reviewBody.value = '';
      reviewDialog.style.display = 'none';
    });

    reviewBody.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitReviewBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelReviewBtn.click();
      }
    });

    confirmMergeBtn.addEventListener('click', () => {
      const strategy = mergeStrategy.value;
      console.log('[Forgejo Webview] Confirm merge clicked, strategy:', strategy);
      confirmMergeBtn.disabled = true;
      confirmMergeBtn.textContent = 'Merging...';
      vscode.postMessage({ type: 'merge', strategy });
    });

    cancelMergeBtn.addEventListener('click', () => {
      console.log('[Forgejo Webview] Cancel merge clicked');
      mergeDialog.style.display = 'none';
    });

    ciStatusList.addEventListener('click', (e) => {
      const action = e.target.closest('[data-ci-action]');
      if (action && currentData && currentData.statuses) {
        e.stopPropagation();
        const status = currentData.statuses[Number(action.dataset.statusIndex)];
        if (!status) {
          return;
        }
        if (action.dataset.ciAction === 'logs') {
          vscode.postMessage({ type: 'viewCIStatusLogs', status });
        } else if (action.dataset.ciAction === 'workflow') {
          vscode.postMessage({ type: 'openCIWorkflowFile', status });
        }
        return;
      }

      const item = e.target.closest('.ci-status-item');
      if (item && item.dataset.targetUrl) {
        vscode.postMessage({ type: 'openCIStatus', url: item.dataset.targetUrl });
      }
    });
  }

  function setupMessageHandler() {
    console.log('[Forgejo Webview] Setting up message handler');

    window.addEventListener('message', event => {
      const message = event.data;
      console.log('[Forgejo Webview] Received message:', message.type);

      switch (message.type) {
        case 'update':
          console.log('[Forgejo Webview] Update received, PR:', message.data?.pr?.title);
          currentData = message.data;
          updatePRDetails(currentData);
          break;
        case 'loading':
          console.log('[Forgejo Webview] Loading state:', message.show);
          setLoading(message.show);
          break;
        case 'error':
          console.log('[Forgejo Webview] Error received:', message.message);
          showError(message.message);
          break;
        case 'theme':
          console.log('[Forgejo Webview] Theme received:', message.theme);
          applyTheme(message.theme);
          break;
        case 'actionComplete':
          console.log('[Forgejo Webview] Action complete:', message.action, 'success:', message.success);
          handleActionComplete(message.action, message.success);
          break;
        case 'bodyUpdated':
          console.log('[Forgejo Webview] Body updated');
          if (currentData && currentData.pr) {
            currentData.pr.body = message.body;
          }
          prDescriptionEl.innerHTML = message.body ? renderMarkdown(message.body) : '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
          setupCheckboxListeners();
          descriptionEditor.style.display = 'none';
          prDescriptionEl.style.display = 'block';
          editDescriptionBtn.style.display = 'inline-flex';
          break;
        default:
          console.log('[Forgejo Webview] Unknown message type:', message.type);
      }
    });
  }

  function handleActionComplete(action, success) {
    switch (action) {
      case 'addComment':
        submitCommentBtn.disabled = false;
        submitCommentBtn.textContent = 'Submit';
        if (success) {
          commentInput.value = '';
          commentInputContainer.style.display = 'none';
        }
        break;
      case 'addReview':
        submitReviewBtn.disabled = false;
        submitReviewBtn.textContent = 'Submit Review';
        if (success) {
          reviewBody.value = '';
          reviewDialog.style.display = 'none';
        }
        break;
      case 'merge':
        confirmMergeBtn.disabled = false;
        confirmMergeBtn.textContent = 'Merge';
        if (success) {
          mergeDialog.style.display = 'none';
        }
        break;
      case 'updateBody':
        saveDescriptionBtn.disabled = false;
        saveDescriptionBtn.textContent = 'Save';
        if (!success) {
          // Keep editor open on failure so user doesn't lose changes
        }
        break;
    }
  }

  function setLoading(show) {
    console.log('[Forgejo Webview] setLoading:', show);
    if (show) {
      loadingEl.style.display = 'flex';
      contentEl.style.display = 'none';
      errorEl.style.display = 'none';
    } else {
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';
      errorEl.style.display = 'none';
    }
  }

  function showError(message) {
    console.log('[Forgejo Webview] showError:', message);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updatePRDetails(data) {
    console.log('[Forgejo Webview] Updating PR details');
    const { pr, activities, statuses, owner, repo } = data;

    // Update header
    prTitleEl.textContent = pr.title || 'Untitled PR';
    prNumberEl.textContent = `#${pr.number || '?'}`;

    // Update status badge
    let statusText = pr.state || 'open';
    let statusClass = (pr.state || 'open').toLowerCase();

    if (pr.draft) {
      statusText = 'Draft';
      statusClass = 'draft';
    } else if (pr.merged) {
      statusText = 'Merged';
      statusClass = 'merged';
    }

    prStatusBadge.textContent = statusText;
    prStatusBadge.className = 'status-badge ' + statusClass;

    const mergeability = getMergeability(pr);
    if (mergeability.state === 'notApplicable') {
      prMergeabilityBadge.style.display = 'none';
      prMergeabilityBadge.textContent = '';
      prMergeabilityBadge.title = '';
      prMergeabilityBadge.className = 'mergeability-badge';
    } else {
      prMergeabilityBadge.style.display = 'inline-flex';
      prMergeabilityBadge.textContent = mergeability.label;
      prMergeabilityBadge.title = mergeability.description;
      prMergeabilityBadge.className = 'mergeability-badge ' + mergeability.state;
    }

    // Update author
    if (pr.user && pr.user.avatar_url) {
      authorAvatar.src = pr.user.avatar_url;
      authorAvatar.style.display = 'inline-block';
    } else {
      authorAvatar.style.display = 'none';
    }
    authorName.textContent = pr.user ? pr.user.login : 'Unknown';

    // Update branches
    if (pr.base) {
      baseBranch.textContent = pr.base.ref || 'unknown';
    }
    if (pr.head) {
      headBranch.textContent = pr.head.ref || 'unknown';
    }

    // Update labels
    if (pr.labels && pr.labels.length > 0) {
      labelsContainer.style.display = 'flex';
      labelsContainer.innerHTML = pr.labels.map(label => {
        const bgColor = label.color ? `#${label.color}` : 'var(--vscode-badge-background)';
        const textColor = getContrastColor(label.color || '000000');
        return `<span class="label" style="background-color: ${bgColor}; color: ${textColor};">${escapeHtml(label.name)}</span>`;
      }).join('');
    } else {
      labelsContainer.style.display = 'none';
    }

    // Update assignees
    if (pr.assignees && pr.assignees.length > 0) {
      assigneesContainer.style.display = 'flex';
      assigneesContainer.innerHTML = '<span class="assignees-label">Assignees:</span> ' +
        pr.assignees.map(a => `<span class="assignee">${escapeHtml(a.login)}</span>`).join(', ');
    } else {
      assigneesContainer.style.display = 'none';
    }

    // Update milestone
    if (pr.milestone) {
      milestoneContainer.style.display = 'flex';
      milestoneContainer.innerHTML = '<span class="milestone-label">Milestone:</span> ' +
        `<span class="milestone">${escapeHtml(pr.milestone.title)}</span>`;
    } else {
      milestoneContainer.style.display = 'none';
    }

    // Update description with Markdown rendering
    if (pr.body) {
      prDescriptionEl.innerHTML = renderMarkdown(pr.body);
      setupCheckboxListeners();
    } else {
      prDescriptionEl.innerHTML = '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
    }
    // Reset edit state
    descriptionEditor.style.display = 'none';
    prDescriptionEl.style.display = 'block';
    editDescriptionBtn.style.display = 'inline-flex';

    // Update CI status
    if (statuses && statuses.length > 0) {
      console.log('[Forgejo Webview] CI statuses:', statuses.length);
      ciSection.style.display = 'block';
      ciSection.classList.add('active');
      ciStatusList.innerHTML = statuses.map((status, index) => {
        const statusClass = status.status || 'pending';
        const statusIcon = statusIconForStatus(statusClass);
        const timeAgo = formatTimeAgo(status.updated_at || status.created_at);
        const isFailed = statusClass === 'failure' || statusClass === 'error';
        const statusActions = isFailed ? `
            <span class="ci-status-actions">
              <button class="ci-status-action" type="button" data-ci-action="logs" data-status-index="${index}" title="View failed job logs">Logs</button>
              <button class="ci-status-action" type="button" data-ci-action="workflow" data-status-index="${index}" title="Open matching workflow file">Workflow</button>
            </span>
        ` : '';
        return `
          <div class="ci-status-item ${statusClass}" data-target-url="${escapeHtml(status.target_url || '')}">
            <span class="ci-status-icon">${statusIcon}</span>
            <span class="ci-status-context">${escapeHtml(status.context || 'Unknown')}</span>
            <span class="ci-status-description">${escapeHtml(status.description || '')}</span>
            <span class="ci-status-time">${timeAgo}</span>
            ${statusActions}
            ${status.target_url ? '<span class="ci-status-link-icon" title="View CI details">&#x2197;</span>' : ''}
          </div>
        `;
      }).join('');
    } else {
      console.log('[Forgejo Webview] No CI statuses');
      ciSection.style.display = 'none';
      ciSection.classList.remove('active');
    }

    // Update action buttons
    console.log('[Forgejo Webview] PR state:', pr.state, 'draft:', pr.draft, 'merged:', pr.merged);
    if (pr.state === 'open' && !pr.draft) {
      mergeActionsEl.style.display = 'flex';
      revertActionsEl.style.display = 'none';
      if (mergeBtn) {
        const hasConflicts = mergeability.state === 'conflicting';
        mergeBtn.disabled = hasConflicts;
        mergeBtn.title = hasConflicts ? mergeability.description : '';
      }
    } else if (pr.merged) {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'flex';
      if (mergeBtn) {
        mergeBtn.disabled = false;
        mergeBtn.title = '';
      }
    } else {
      mergeActionsEl.style.display = 'none';
      revertActionsEl.style.display = 'none';
      if (mergeBtn) {
        mergeBtn.disabled = false;
        mergeBtn.title = '';
      }
    }

    // Update activity timeline
    currentOwner = owner;
    currentRepo = repo;
    currentActivities = activities || [];
    currentActivitySortOrder = data.activitySortOrder === 'oldest-first' ? 'oldest-first' : 'newest-first';
    currentHistoryTruncated = Boolean(data.historyTruncated);
    currentHistoryIsNewest = data.historyIsNewest !== false;
    renderActivityTimeline();

    // Show content
    setLoading(false);
    console.log('[Forgejo Webview] PR details updated successfully');
  }

  function renderActivityTimeline() {
    const activityCount = currentActivities.length;
    console.log('[Forgejo Webview] Activities:', activityCount, 'order:', currentActivitySortOrder);
    activityCountEl.textContent = `(${activityCount} events)`;

    if (activitySortBtn) {
      activitySortBtn.textContent = currentActivitySortOrder === 'oldest-first' ? 'Oldest first' : 'Newest first';
    }

    if (currentActivities.length > 0) {
      // The provider always returns activities sorted newest-first; reverse
      // a copy for oldest-first display instead of re-parsing dates here.
      const ordered = currentActivitySortOrder === 'oldest-first'
        ? currentActivities.slice().reverse()
        : currentActivities;
      activityTimeline.innerHTML = ordered.map(activity => renderActivity(activity, currentOwner, currentRepo)).join('');
    } else {
      activityTimeline.innerHTML = '<p style="color: var(--vscode-descriptionForeground); padding: 16px;">No activity yet.</p>';
    }
    if (currentHistoryTruncated) {
      activityTimeline.innerHTML += currentHistoryIsNewest === false
        ? '<p class="activity-history-notice">Showing a bounded activity/status sample; the newest entries could not be located safely. Use Open in Web to view the complete history.</p>'
        : '<p class="activity-history-notice">Showing the newest 50 entries per activity/status source. Use Open in Web to view older history.</p>';
    }
  }

  function getMergeability(pr) {
    if (pr.merged || pr.state === 'closed' || pr.draft) {
      return {
        state: 'notApplicable',
        label: 'Not applicable',
        description: pr.merged
          ? 'Already merged'
          : pr.draft
          ? 'Draft pull requests cannot be merged yet'
          : 'Closed pull requests cannot be merged'
      };
    }

    if (pr.mergeable === true) {
      return {
        state: 'mergeable',
        label: 'Ready to merge',
        description: 'Forgejo reports this pull request can be merged cleanly'
      };
    }

    if (pr.mergeable === false) {
      return {
        state: 'conflicting',
        label: 'Merge conflicts',
        description: 'Forgejo reports this pull request cannot be merged cleanly'
      };
    }

    return {
      state: 'unknown',
      label: 'Mergeability unknown',
      description: 'Forgejo has not reported whether this pull request can be merged'
    };
  }

  /**
   * Toggle a task list checkbox in the raw markdown body.
   * Finds the Nth task list item (- [ ] or - [x]) and toggles it.
   */
  function toggleCheckboxInBody(body, checkboxIndex, checked) {
    var taskPattern = /- \[[ xX]\]/g;
    var count = 0;
    return body.replace(taskPattern, function(match) {
      if (count++ === checkboxIndex) {
        return checked ? '- [x]' : '- [ ]';
      }
      return match;
    });
  }

  /**
   * Set up click handlers on task list checkboxes to make them interactive.
   */
  function setupCheckboxListeners() {
    var checkboxes = prDescriptionEl.querySelectorAll('.task-checkbox');
    checkboxes.forEach(function(checkbox, index) {
      checkbox.addEventListener('change', function(e) {
        console.log('[Forgejo Webview] Checkbox toggled:', index, 'checked:', e.target.checked);
        if (currentData && currentData.pr && currentData.pr.body) {
          var newBody = toggleCheckboxInBody(currentData.pr.body, index, e.target.checked);
          currentData.pr.body = newBody;
          vscode.postMessage({ type: 'updateBody', body: newBody });
        }
      });
    });
  }

  function renderActivity(activity, owner, repo) {
    const timeAgo = formatTimeAgo(activity.created_at || activity.submitted_at || activity.committed_at);
    const userAvatar = activity.user && typeof activity.user === 'object' ? activity.user.avatar_url : '';
    const userLogin = getActivityUserLogin(activity);
    const escapedUserAvatar = escapeHtml(userAvatar || '');

    if (activity.type === 'comment') {
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${escapedUserAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">commented</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${activity.body ? `<div class="activity-body markdown-body">${renderMarkdown(activity.body)}</div>` : ''}
          </div>
        </div>
      `;
    }

    if (activity.type === 'review') {
      const reviewClass = activity.state === 'APPROVED' ? 'approved' :
                         activity.state === 'REQUEST_CHANGES' ? 'changes_requested' : 'commented';
      const reviewState = activity.state ? activity.state.toLowerCase().replace(/_/g, ' ') : 'commented';
      return `
        <div class="activity-item activity-review ${reviewClass}">
          <img class="activity-avatar" src="${escapedUserAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">reviewed: ${reviewState}</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${activity.body ? `<div class="activity-body markdown-body">${renderMarkdown(activity.body)}</div>` : ''}
          </div>
        </div>
      `;
    }

    if (activity.type === 'commit') {
      const commitSummary = renderCommitSummary(activity);
      return `
        <div class="activity-item activity-commit-item">
          <img class="activity-avatar" src="${escapedUserAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">committed</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${commitSummary}
          </div>
        </div>
      `;
    }

    if (activity.type === 'timeline') {
      const timelineDetails = renderTimelineDetails(activity);
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${escapedUserAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-action">${renderTimelineEvent(activity)}</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
            ${timelineDetails}
          </div>
        </div>
      `;
    }

    return '';
  }

  function getActivityUserLogin(activity) {
    if (!activity.user) return 'Someone';
    if (typeof activity.user === 'string') return activity.user;
    return activity.user.login || 'Someone';
  }

  function firstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value === undefined || value === null) continue;
      var text = String(value).trim();
      if (text.length > 0) return text;
    }
    return '';
  }

  function firstLine(text) {
    return firstNonEmpty(text).split(/\r?\n/)[0].trim();
  }

  function getActivityBranch(activity) {
    return firstNonEmpty(
      activity.branch,
      activity.branch_name,
      activity.ref,
      activity.ref_name,
      activity.head_branch,
      activity.head && activity.head.ref,
      activity.pull_head && activity.pull_head.ref
    );
  }

  function getActivityCommitSha(activity) {
    return firstNonEmpty(
      activity.sha,
      activity.commit_sha,
      activity.commit_id,
      activity.merge_commit_sha,
      activity.commit && activity.commit.sha,
      activity.commit && activity.commit.id
    );
  }

  function getActivityCommitMessage(activity) {
    return firstLine(firstNonEmpty(
      activity.message,
      activity.commit_message,
      activity.commit_title,
      activity.title,
      activity.commit && activity.commit.message,
      activity.commit && activity.commit.title
    ));
  }

  function shortSha(sha) {
    return firstNonEmpty(sha).substring(0, 7);
  }

  function renderCommitSummary(activity) {
    const sha = getActivityCommitSha(activity);
    const title = getActivityCommitMessage(activity);
    const url = activity.html_url || activity.url || activity.commit_url || '';
    const safeUrl = url ? sanitizeUrl(url) : '';

    if (!sha && !title) return '';

    const shaText = shortSha(sha);
    const shaMarkup = shaText
      ? (safeUrl
        ? `<a class="activity-commit-sha" href="${escapeHtml(safeUrl)}">${escapeHtml(shaText)}</a>`
        : `<span class="activity-commit-sha">${escapeHtml(shaText)}</span>`)
      : '';
    const titleMarkup = title ? `<span class="activity-commit-message">${escapeHtml(title)}</span>` : '';

    return `
      <div class="activity-commit">
        ${shaMarkup}
        ${titleMarkup}
      </div>
    `;
  }

  function renderTimelineDetails(activity) {
    if (activity.event === 'pull_push' || activity.event === 'merge_pull' || activity.event === 'commit_ref') {
      const commitSummary = renderCommitSummary(activity);
      return commitSummary ? `<div class="activity-event-details">${commitSummary}</div>` : '';
    }

    return '';
  }

  function getTimelineBody(activity) {
    if (typeof activity.body === 'string') return activity.body;
    if (typeof activity.content === 'string') return activity.content;
    return '';
  }

  function getLabelEventVerb(activity) {
    if (activity.event === 'labeled') return 'added';
    if (activity.event === 'unlabeled') return 'removed';
    if (activity.event !== 'label') return '';

    var body = getTimelineBody(activity).trim();
    if (body === '1') return 'added';
    if (body.length === 0) return 'removed';
    return '';
  }

  function getFiniteSeconds(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
  }

  function formatTimelineDuration(totalSeconds) {
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var parts = [];

    if (hours > 0) parts.push(hours + 'h');
    if (minutes > 0) parts.push(minutes + 'm');
    if (seconds > 0 || parts.length === 0) parts.push(seconds + 's');
    return parts.join(' ');
  }

  function getTrackedTimeText(activity) {
    var trackedTime = activity.tracked_time || {};
    var legacyTime = activity.time && typeof activity.time === 'object' ? activity.time : {};
    var secondValues = [
      getFiniteSeconds(trackedTime.time),
      getFiniteSeconds(trackedTime.seconds),
      getFiniteSeconds(legacyTime.time),
      getFiniteSeconds(legacyTime.seconds),
      getFiniteSeconds(activity.time),
      getFiniteSeconds(activity.seconds)
    ];

    for (var i = 0; i < secondValues.length; i++) {
      if (secondValues[i] !== undefined) {
        return formatTimelineDuration(secondValues[i]);
      }
    }

    var durationValues = [trackedTime.duration, legacyTime.duration, activity.duration, getTimelineBody(activity)];
    for (var d = 0; d < durationValues.length; d++) {
      if (typeof durationValues[d] === 'string' && durationValues[d].trim().length > 0 && durationValues[d].trim() !== '1') {
        return durationValues[d].trim();
      }
    }

    return '';
  }

  function renderTimelineEvent(activity) {
    if (!activity.event) return 'performed an action';

    const events = {
      // Forgejo API timeline type values (from API response)
      'close': 'closed this pull request',
      'reopen': 'reopened this pull request',
      'comment': 'commented',
      'label': 'added/removed a label',
      'milestone': 'changed the milestone',
      'assignees': 'changed assignees',
      'change_title': 'changed the title',
      'delete_branch': 'deleted the head branch',
      'merge_pull': 'merged this pull request',
      'review': 'submitted a review',
      'review_request': 'requested a review',
      'dismiss_review': 'dismissed a review',
      'lock': 'locked this pull request',
      'unlock': 'unlocked this pull request',
      'pin': 'pinned this pull request',
      'unpin': 'unpinned this pull request',
      'change_target_branch': 'changed the target branch',
      'pull_push': 'pushed commits',
      'commit_ref': 'referenced this pull request',
      'issue_ref': 'referenced this pull request',
      'comment_ref': 'referenced this pull request',
      'pull_ref': 'referenced this pull request',
      'code': 'commented on code',
      'project': 'changed the project',
      'project_board': 'moved in project board',
      'added_deadline': 'added a deadline',
      'modified_deadline': 'modified the deadline',
      'removed_deadline': 'removed the deadline',
      'add_dependency': 'added a dependency',
      'remove_dependency': 'removed a dependency',
      'start_tracking': 'started time tracking',
      'stop_tracking': 'stopped time tracking',
      'add_time_manual': 'added tracked time',
      'cancel_tracking': 'cancelled time tracking',
      'delete_time_manual': 'removed tracked time',
      'change_issue_ref': 'changed the issue reference',
      'pull_scheduled_merge': 'scheduled auto-merge',
      'pull_cancel_scheduled_merge': 'cancelled auto-merge',
      // GitHub-style event names (fallback compatibility)
      'closed': 'closed this pull request',
      'merged': 'merged this pull request',
      'reopened': 'reopened this pull request',
      'reviewed': 'submitted a review',
      'approved': 'approved this pull request',
      'rejected': 'requested changes',
      'commented': 'commented',
      'labeled': 'added a label',
      'unlabeled': 'removed a label',
      'milestoned': 'added to a milestone',
      'demilestoned': 'removed from a milestone',
      'referenced': 'referenced this pull request',
      'assigned': 'was assigned',
      'unassigned': 'was unassigned',
      'locked': 'locked this pull request',
      'unlocked': 'unlocked this pull request',
      'pinned': 'pinned this pull request',
      'unpinned': 'unpinned this pull request',
      'head_ref_deleted': 'deleted the head branch',
      'head_ref_restored': 'restored the head branch',
      'marked_ready_for_review': 'marked as ready for review',
      'converted_to_draft': 'converted to draft'
    };

    var eventText = events[activity.event] || activity.event;
    var branchName = getActivityBranch(activity);
    var commitSha = getActivityCommitSha(activity);

    // Enhance with contextual details when available
    if (activity.event === 'label' && activity.label) {
      var labelVerb = getLabelEventVerb(activity);
      eventText = labelVerb
        ? labelVerb + ' label <strong>' + escapeHtml(activity.label.name || '') + '</strong>'
        : eventText + ' <strong>' + escapeHtml(activity.label.name || '') + '</strong>';
    }
    if ((activity.event === 'labeled' || activity.event === 'unlabeled') && activity.label) {
      eventText = getLabelEventVerb(activity) + ' label <strong>' + escapeHtml(activity.label.name || '') + '</strong>';
    }
    if (activity.event === 'change_title' && activity.old_title && activity.new_title) {
      eventText = 'changed title from <del>' + escapeHtml(activity.old_title) + '</del> to <strong>' + escapeHtml(activity.new_title) + '</strong>';
    }
    if (activity.event === 'assignees' && activity.assignee) {
      eventText = (activity.removed_assignee ? 'unassigned ' : 'assigned ') + '<strong>' + escapeHtml(activity.assignee.login || '') + '</strong>';
    }
    if (activity.event === 'milestone' && activity.milestone) {
      eventText = 'set milestone to <strong>' + escapeHtml(activity.milestone.title || '') + '</strong>';
    }
    var trackedTimeText = getTrackedTimeText(activity);
    if (activity.event === 'add_time_manual' && trackedTimeText) {
      eventText = 'added <strong>' + escapeHtml(trackedTimeText) + '</strong> tracked time';
    }
    if (activity.event === 'stop_tracking' && trackedTimeText) {
      eventText = 'stopped time tracking and added <strong>' + escapeHtml(trackedTimeText) + '</strong>';
    }
    if (activity.event === 'delete_time_manual' && trackedTimeText) {
      eventText = 'removed <strong>' + escapeHtml(trackedTimeText) + '</strong> tracked time';
    }
    if (activity.event === 'delete_branch' && branchName) {
      eventText = 'deleted branch <strong>' + escapeHtml(branchName) + '</strong>';
    }
    if (activity.event === 'pull_push' && branchName) {
      eventText = 'pushed commits to <strong>' + escapeHtml(branchName) + '</strong>';
    }
    if (activity.event === 'merge_pull') {
      if (branchName) {
        eventText = 'merged this pull request into <strong>' + escapeHtml(branchName) + '</strong>';
      } else if (commitSha) {
        eventText = 'merged this pull request with commit <strong>' + escapeHtml(shortSha(commitSha)) + '</strong>';
      }
    }
    if (activity.event === 'commit_ref') {
      eventText = commitSha
        ? 'referenced this pull request from commit <strong>' + escapeHtml(shortSha(commitSha)) + '</strong>'
        : 'referenced this pull request from a commit';
    }

    return eventText;
  }

  function statusIconForStatus(status) {
    const icons = {
      'pending': '\u23F3',
      'success': '\u2705',
      'error': '\u274C',
      'failure': '\u274C',
      'warning': '\u26A0\uFE0F'
    };
    return icons[status] || icons['pending'];
  }

  function formatTimeAgo(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffDays < 365) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getContrastColor(hexColor) {
    // Convert hex to RGB
    const r = parseInt(hexColor.substr(0, 2), 16);
    const g = parseInt(hexColor.substr(2, 2), 16);
    const b = parseInt(hexColor.substr(4, 2), 16);

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Return black or white based on luminance
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  /**
   * Converts Markdown text to sanitized HTML.
   *
   * Supported syntax:
   * - Fenced code blocks (```lang ... ```)
   * - Inline code (`code`)
   * - Headings (h1-h6 via # syntax)
   * - Bold (**text** or __text__), italic (*text* or _text_), bold+italic
   * - Strikethrough (~~text~~)
   * - Links ([text](url)) and images (![alt](url))
   * - Blockquotes (> text)
   * - Unordered lists (-, *, +) and ordered lists (1. 2. 3.)
   * - Task lists (- [x] done, - [ ] todo)
   * - Tables (pipe-delimited with alignment support)
   * - Horizontal rules (---, ***, ___)
   *
   * Input is HTML-escaped first to prevent XSS, then markdown syntax is converted.
   */
  function renderMarkdown(text) {
    if (!text) return '';

    // Escape HTML first for security
    var html = escapeHtml(text);

    // Placeholder map to protect code blocks from further processing
    var codeBlocks = [];

    // Extract fenced code blocks and replace with placeholders
    // Single regex handles both ``` with and without newline after language tag
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_match, lang, code) {
      var langAttr = lang ? ' class="language-' + lang + '"' : '';
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code' + langAttr + '>' + code + '</code></pre>');
      return '\n%%CODEBLOCK_' + idx + '%%\n';
    });

    // Extract inline code and replace with placeholders
    var inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, function(_match, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code>' + code + '</code>');
      return '%%INLINECODE_' + idx + '%%';
    });

    // Split into lines for block-level processing
    var lines = html.split('\n');
    var result = [];
    var inList = false;
    var listType = '';
    var inBlockquote = false;
    var blockquoteLines = [];
    var inTable = false;
    var tableLines = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Code block placeholder -- pass through directly
      if (line.trim().match(/^%%CODEBLOCK_\d+%%$/)) {
        // Close any open structures first
        if (inList) { result.push('</' + listType + '>'); inList = false; listType = ''; }
        if (inBlockquote) { result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); blockquoteLines = []; inBlockquote = false; }
        if (inTable) { result.push(buildTable(tableLines)); tableLines = []; inTable = false; }
        result.push(line.trim());
        continue;
      }

      // Close blockquote if current line is not a blockquote line
      if (inBlockquote && !line.match(/^&gt;\s?/)) {
        result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>');
        blockquoteLines = [];
        inBlockquote = false;
      }

      // Close table if current line is not a table row
      if (inTable && !line.match(/^\|/)) {
        result.push(buildTable(tableLines));
        tableLines = [];
        inTable = false;
      }

      // Close list if current line is not a list item and not empty
      if (inList && line.trim() !== '' && !line.match(/^(\s*[-*+]\s|\s*\d+\.\s)/)) {
        result.push('</' + listType + '>');
        inList = false;
        listType = '';
      }

      // Horizontal rule (handles spaced variants like "- - -", "* * *", "_ _ _")
      if (line.match(/^\s*([-*_]\s*){3,}$/)) {
        if (inList) { result.push('</' + listType + '>'); inList = false; listType = ''; }
        result.push('<hr>');
        continue;
      }

      // Headings (h1-h6)
      var headingMatch = line.match(/^(#{1,6})\s+(.*?)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var headingText = processInline(headingMatch[2]);
        result.push('<h' + level + '>' + headingText + '</h' + level + '>');
        continue;
      }

      // Blockquotes (escaped > becomes &gt;)
      if (line.match(/^&gt;\s?/)) {
        inBlockquote = true;
        blockquoteLines.push(line.replace(/^&gt;\s?/, ''));
        continue;
      }

      // Table rows (lines starting with |)
      if (line.match(/^\|/)) {
        if (!inTable) {
          inTable = true;
          tableLines = [];
        }
        tableLines.push(line);
        continue;
      }

      // Unordered list items
      var ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) { result.push('</' + listType + '>'); }
          result.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        var liContent = ulMatch[2];
        // Task list item: - [x] or - [ ]
        var taskMatch = liContent.match(/^\[([ xX])\]\s+(.*)/);
        if (taskMatch) {
          var checked = taskMatch[1] !== ' ' ? ' checked' : '';
          result.push('<li class="task-list-item"><input type="checkbox" class="task-checkbox" data-line="' + i + '"' + checked + '> ' + processInline(taskMatch[2]) + '</li>');
        } else {
          result.push('<li>' + processInline(liContent) + '</li>');
        }
        continue;
      }

      // Ordered list items
      var olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) { result.push('</' + listType + '>'); }
          result.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        result.push('<li>' + processInline(olMatch[2]) + '</li>');
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        continue;
      }

      // Regular paragraph line
      result.push('<p>' + processInline(line) + '</p>');
    }

    // Close any remaining open elements
    if (inBlockquote) {
      result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>');
    }
    if (inTable) {
      result.push(buildTable(tableLines));
    }
    if (inList) {
      result.push('</' + listType + '>');
    }

    var output = result.join('\n');

    // Restore code block placeholders
    for (var cb = 0; cb < codeBlocks.length; cb++) {
      output = output.replace('%%CODEBLOCK_' + cb + '%%', codeBlocks[cb]);
    }

    // Restore inline code placeholders
    for (var ic = 0; ic < inlineCodes.length; ic++) {
      output = output.replace(new RegExp('%%INLINECODE_' + ic + '%%', 'g'), inlineCodes[ic]);
    }

    return output;
  }

  /**
   * Process blockquote content lines, rendering inline formatting on each line.
   */
  function processBlockquoteContent(lines) {
    return lines.map(function(line) {
      if (line.trim() === '') return '';
      return '<p>' + processInline(line) + '</p>';
    }).join('\n');
  }

  /**
   * Sanitize a URL to only allow safe schemes (http, https, mailto).
   * Returns empty string for javascript:, data:, vbscript:, etc.
   */
  function sanitizeUrl(url) {
    var trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:')) {
      return url.trim();
    }
    return '';
  }

  /**
   * Process inline Markdown elements: images, links, bold+italic, bold, italic,
   * strikethrough. Assumes input is already HTML-escaped.
   *
   * Processing order: images -> links -> bold -> italic -> strikethrough
   */
  function processInline(text) {
    if (!text) return '';

    var htmlTokens = [];
    function addHtmlToken(markup) {
      var idx = htmlTokens.length;
      htmlTokens.push(markup);
      return '%%HTMLTOKEN_' + idx + '%%';
    }

    // Images: ![alt](url) -- processed before links so ![alt](url) is not consumed by link regex
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(_match, alt, url) {
      var safe = sanitizeUrl(url);
      if (!safe) return alt;
      return addHtmlToken('<img src="' + safe + '" alt="' + alt + '" style="max-width:100%;">');
    });

    // Links: [text](url) -- processed after images to avoid matching image syntax
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_match, linkText, url) {
      var safe = sanitizeUrl(url);
      if (!safe) return linkText;
      return addHtmlToken('<a href="' + safe + '">' + applyInlineFormatting(linkText) + '</a>');
    });

    text = autolinkIssueReferences(text);

    text = applyInlineFormatting(text);

    for (var i = 0; i < htmlTokens.length; i++) {
      text = text.replace(new RegExp('%%HTMLTOKEN_' + i + '%%', 'g'), htmlTokens[i]);
    }

    return text;
  }

  function applyInlineFormatting(text) {
    // Bold + italic: ***text*** or ___text___
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

    // Bold: **text** or __text__
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');

    // Strikethrough: ~~text~~
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return text;
  }

  function autolinkIssueReferences(text) {
    var currentOwner = currentData && currentData.owner;
    var currentRepo = currentData && currentData.repo;
    if (!currentOwner || !currentRepo) return text;

    return text.replace(/(^|[\s([{])(([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?#([1-9]\d*)\b/g, function(_match, prefix, repoRef, refOwner, refRepo, number) {
      var fullRef = (repoRef || '') + '#' + number;
      var owner = refOwner || currentOwner;
      var repo = refRepo || currentRepo;
      var url = buildIssueReferenceUrl(owner, repo, number);
      if (!url) return prefix + fullRef;
      return prefix + '<a href="' + escapeHtml(url) + '">' + fullRef + '</a>';
    });
  }

  function buildIssueReferenceUrl(owner, repo, number) {
    var itemUrl = currentData && currentData.pr && currentData.pr.html_url;
    var instanceBase = '';
    if (itemUrl) {
      var currentRepoPath = '/' + currentData.owner + '/' + currentData.repo + '/';
      var repoPathIndex = itemUrl.indexOf(currentRepoPath);
      if (repoPathIndex >= 0) {
        instanceBase = itemUrl.slice(0, repoPathIndex);
      }
    }
    if (!instanceBase && currentData && currentData.instanceUrl) {
      instanceBase = currentData.instanceUrl.replace(/\/$/, '');
    }
    if (!instanceBase) return '';
    return instanceBase + '/' + owner + '/' + repo + '/issues/' + number;
  }

  /**
   * Build an HTML table from pipe-delimited lines.
   * Handles header row, separator row (with alignment via colons), and body rows.
   */
  function buildTable(lines) {
    if (lines.length < 2) {
      return lines.map(function(l) { return '<p>' + processInline(l) + '</p>'; }).join('\n');
    }

    var headerCells = parseTableRow(lines[0]);
    var alignments = [];

    // Check if second line is a separator row (each cell must contain at least one dash)
    var isSeparator = lines[1].replace(/\s/g, '').match(/^\|?(:?-+:?\|)*:?-+:?\|?$/);
    var bodyStartIndex = 1;

    if (isSeparator) {
      bodyStartIndex = 2;
      var sepCells = parseTableRow(lines[1]);
      for (var a = 0; a < sepCells.length; a++) {
        var cell = sepCells[a].trim();
        if (cell.match(/^:-+:$/)) {
          alignments.push('center');
        } else if (cell.match(/^-+:$/)) {
          alignments.push('right');
        } else {
          alignments.push('left');
        }
      }
    }

    var tableHtml = '<table>\n<thead>\n<tr>';
    for (var h = 0; h < headerCells.length; h++) {
      var alignAttr = alignments[h] ? ' style="text-align:' + alignments[h] + '"' : '';
      tableHtml += '<th' + alignAttr + '>' + processInline(headerCells[h].trim()) + '</th>';
    }
    tableHtml += '</tr>\n</thead>\n<tbody>';

    for (var r = bodyStartIndex; r < lines.length; r++) {
      var cells = parseTableRow(lines[r]);
      tableHtml += '\n<tr>';
      for (var c = 0; c < cells.length; c++) {
        var cellAlignAttr = alignments[c] ? ' style="text-align:' + alignments[c] + '"' : '';
        tableHtml += '<td' + cellAlignAttr + '>' + processInline(cells[c].trim()) + '</td>';
      }
      tableHtml += '</tr>';
    }

    tableHtml += '\n</tbody>\n</table>';
    return tableHtml;
  }

  /**
   * Parse a pipe-delimited table row into an array of cell contents.
   */
  function parseTableRow(row) {
    var trimmed = row.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|');
  }

  function applyTheme(theme) {
    console.log('[Forgejo Webview] Applying theme:', theme);
    document.body.className = '';
    if (theme === 'light') {
      document.body.classList.add('vscode-light');
    } else if (theme === 'dark') {
      document.body.classList.add('vscode-dark');
    } else if (theme === 'high-contrast') {
      document.body.classList.add('vscode-high-contrast');
    }
  }

  // Start
  console.log('[Forgejo Webview] Starting initialization');
  init();
})();
