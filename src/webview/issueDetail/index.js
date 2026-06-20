(function() {
  const vscode = acquireVsCodeApi();
  let currentData = null;
  let isReady = false;

  console.log('[Forgejo Issue Webview] Script loaded');

  // DOM Elements
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const retryBtn = document.getElementById('retry-btn');
  const contentEl = document.getElementById('content');

  const issueTitleEl = document.getElementById('issue-title');
  const issueNumberEl = document.getElementById('issue-number');
  const copyUrlBtn = document.getElementById('copy-url-btn');
  const issueStatusBadge = document.getElementById('issue-status-badge');
  const authorAvatar = document.getElementById('author-avatar');
  const authorName = document.getElementById('author-name');
  const issueCreated = document.getElementById('issue-created');
  const labelsContainer = document.getElementById('labels-container');
  const assigneesContainer = document.getElementById('assignees-container');

  const refreshBtn = document.getElementById('refresh-btn');
  const openWebBtn = document.getElementById('open-web-btn');
  const closeIssueBtn = document.getElementById('close-issue-btn');
  const reopenIssueBtn = document.getElementById('reopen-issue-btn');

  const issueDescriptionEl = document.getElementById('issue-description');
  const editDescriptionBtn = document.getElementById('edit-description-btn');
  const descriptionEditor = document.getElementById('issue-description-editor');
  const descriptionTextarea = document.getElementById('description-textarea');
  const saveDescriptionBtn = document.getElementById('save-description-btn');
  const cancelDescriptionBtn = document.getElementById('cancel-description-btn');
  const activityCountEl = document.getElementById('activity-count');
  const activityTimeline = document.getElementById('activity-timeline');

  const commentInputContainer = document.getElementById('comment-input-container');
  const commentInput = document.getElementById('comment-input');
  const submitCommentBtn = document.getElementById('submit-comment-btn');
  const cancelCommentBtn = document.getElementById('cancel-comment-btn');

  // Initialize
  function init() {
    console.log('[Forgejo Issue Webview] Initializing...');
    setupEventListeners();
    setupMessageHandler();

    // Notify extension that webview is ready
    console.log('[Forgejo Issue Webview] Posting ready message');
    vscode.postMessage({ type: 'ready' });
    isReady = true;
  }

  function setupEventListeners() {
    console.log('[Forgejo Issue Webview] Setting up event listeners');

    retryBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Retry clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    copyUrlBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Copy URL clicked');
      if (currentData && currentData.issue && currentData.issue.html_url) {
        navigator.clipboard.writeText(currentData.issue.html_url);
        copyUrlBtn.textContent = '✓';
        setTimeout(() => {
          copyUrlBtn.textContent = '📋';
        }, 2000);
      }
    });

    refreshBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Refresh clicked');
      vscode.postMessage({ type: 'refresh' });
    });

    openWebBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Open in web clicked');
      vscode.postMessage({ type: 'openInBrowser' });
    });

    closeIssueBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Close issue clicked');
      vscode.postMessage({ type: 'closeIssue' });
    });

    reopenIssueBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Reopen issue clicked');
      vscode.postMessage({ type: 'reopenIssue' });
    });

    editDescriptionBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Edit description clicked');
      if (currentData && currentData.issue) {
        descriptionTextarea.value = currentData.issue.body || '';
        issueDescriptionEl.style.display = 'none';
        descriptionEditor.style.display = 'block';
        editDescriptionBtn.style.display = 'none';
        descriptionTextarea.focus();
      }
    });

    saveDescriptionBtn.addEventListener('click', () => {
      var body = descriptionTextarea.value;
      console.log('[Forgejo Issue Webview] Save description clicked');
      saveDescriptionBtn.disabled = true;
      saveDescriptionBtn.textContent = 'Saving...';
      vscode.postMessage({ type: 'updateBody', body: body });
    });

    cancelDescriptionBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Cancel description edit clicked');
      descriptionEditor.style.display = 'none';
      issueDescriptionEl.style.display = 'block';
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
      console.log('[Forgejo Issue Webview] Submit comment clicked, body length:', body.length);
      if (body) {
        vscode.postMessage({ type: 'addComment', body });
        commentInput.value = '';
      }
    });

    cancelCommentBtn.addEventListener('click', () => {
      console.log('[Forgejo Issue Webview] Clear comment clicked');
      commentInput.value = '';
      commentInput.focus();
    });
  }

  function setupMessageHandler() {
    console.log('[Forgejo Issue Webview] Setting up message handler');

    window.addEventListener('message', event => {
      const message = event.data;
      console.log('[Forgejo Issue Webview] Received message:', message.type);

      switch (message.type) {
        case 'update':
          console.log('[Forgejo Issue Webview] Update received, Issue:', message.data?.issue?.title);
          currentData = message.data;
          updateIssueDetails(currentData);
          break;
        case 'loading':
          console.log('[Forgejo Issue Webview] Loading state:', message.show);
          setLoading(message.show);
          break;
        case 'error':
          console.log('[Forgejo Issue Webview] Error received:', message.message);
          showError(message.message);
          break;
        case 'theme':
          console.log('[Forgejo Issue Webview] Theme received:', message.theme);
          applyTheme(message.theme);
          break;
        case 'bodyUpdated':
          console.log('[Forgejo Issue Webview] Body updated');
          if (currentData && currentData.issue) {
            currentData.issue.body = message.body;
          }
          if (message.body) {
            issueDescriptionEl.innerHTML = renderMarkdown(message.body);
            setupCheckboxListeners();
          } else {
            issueDescriptionEl.innerHTML = '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
          }
          descriptionEditor.style.display = 'none';
          issueDescriptionEl.style.display = 'block';
          editDescriptionBtn.style.display = 'inline-flex';
          break;
        case 'actionComplete':
          console.log('[Forgejo Issue Webview] Action complete:', message.action, 'success:', message.success);
          if (message.action === 'updateBody') {
            saveDescriptionBtn.disabled = false;
            saveDescriptionBtn.textContent = 'Save';
          }
          break;
        default:
          console.log('[Forgejo Issue Webview] Unknown message type:', message.type);
      }
    });
  }

  function setLoading(show) {
    console.log('[Forgejo Issue Webview] setLoading:', show);
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
    console.log('[Forgejo Issue Webview] showError:', message);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }

  function updateIssueDetails(data) {
    console.log('[Forgejo Issue Webview] Updating Issue details');
    const { issue, activities, owner, repo } = data;

    // Update header
    issueTitleEl.textContent = issue.title || 'Untitled Issue';
    issueNumberEl.textContent = `#${issue.number || '?'}`;

    // Update status badge
    const statusText = issue.state || 'open';
    const statusClass = (issue.state || 'open').toLowerCase();

    issueStatusBadge.textContent = statusText;
    issueStatusBadge.className = 'status-badge ' + statusClass;

    // Update author
    if (issue.user && issue.user.avatar_url) {
      authorAvatar.src = issue.user.avatar_url;
      authorAvatar.style.display = 'inline-block';
    } else {
      authorAvatar.style.display = 'none';
    }
    authorName.textContent = issue.user ? issue.user.login : 'Unknown';

    // Update created date
    if (issue.created_at) {
      issueCreated.textContent = 'opened ' + formatTimeAgo(issue.created_at);
    }

    // Update labels
    if (issue.labels && issue.labels.length > 0) {
      labelsContainer.style.display = 'flex';
      labelsContainer.innerHTML = issue.labels.map(label => {
        const bgColor = label.color ? `#${label.color}` : 'var(--vscode-badge-background)';
        const textColor = getContrastColor(label.color || '000000');
        return `<span class="label" style="background-color: ${bgColor}; color: ${textColor};">${escapeHtml(label.name)}</span>`;
      }).join('');
    } else {
      labelsContainer.style.display = 'none';
    }

    // Update assignees
    if (issue.assignees && issue.assignees.length > 0) {
      assigneesContainer.style.display = 'flex';
      assigneesContainer.innerHTML = '<span class="assignees-label">Assignees:</span> ' +
        issue.assignees.map(a => `<span class="assignee">${escapeHtml(a.login)}</span>`).join(', ');
    } else {
      assigneesContainer.style.display = 'none';
    }

    // Update description with Markdown rendering
    if (issue.body) {
      issueDescriptionEl.innerHTML = renderMarkdown(issue.body);
      setupCheckboxListeners();
    } else {
      issueDescriptionEl.innerHTML = '<p style="color:var(--vscode-descriptionForeground)">No description provided.</p>';
    }
    // Reset edit state
    descriptionEditor.style.display = 'none';
    issueDescriptionEl.style.display = 'block';
    editDescriptionBtn.style.display = 'inline-flex';

    // Update action buttons
    console.log('[Forgejo Issue Webview] Issue state:', issue.state);
    const canComment = data.canComment === true;
    commentInputContainer.style.display = canComment ? 'block' : 'none';
    document.body.classList.toggle('has-comment-input', canComment);
    if (!canComment) {
      commentInput.value = '';
    }

    if (issue.state === 'open') {
      closeIssueBtn.style.display = 'inline-flex';
      reopenIssueBtn.style.display = 'none';
    } else {
      closeIssueBtn.style.display = 'none';
      reopenIssueBtn.style.display = 'inline-flex';
    }

    // Update activity timeline
    const activityCount = activities ? activities.length : 0;
    console.log('[Forgejo Issue Webview] Activities:', activityCount);
    activityCountEl.textContent = `(${activityCount} events)`;

    if (activities && activities.length > 0) {
      activityTimeline.innerHTML = activities.map(activity => renderActivity(activity, owner, repo)).join('');
    } else {
      activityTimeline.innerHTML = '<p style="color: var(--vscode-descriptionForeground); padding: 16px;">No activity yet.</p>';
    }

    // Show content
    setLoading(false);
    console.log('[Forgejo Issue Webview] Issue details updated successfully');
  }

  /**
   * Toggle a task list checkbox in the raw markdown body.
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
   * Set up click handlers on task list checkboxes.
   */
  function setupCheckboxListeners() {
    var checkboxes = issueDescriptionEl.querySelectorAll('.task-checkbox');
    checkboxes.forEach(function(checkbox, index) {
      checkbox.addEventListener('change', function(e) {
        console.log('[Forgejo Issue Webview] Checkbox toggled:', index, 'checked:', e.target.checked);
        if (currentData && currentData.issue && currentData.issue.body) {
          var newBody = toggleCheckboxInBody(currentData.issue.body, index, e.target.checked);
          currentData.issue.body = newBody;
          vscode.postMessage({ type: 'updateBody', body: newBody });
        }
      });
    });
  }

  /**
   * Converts Markdown text to sanitized HTML.
   */
  function renderMarkdown(text) {
    if (!text) return '';

    var html = escapeHtml(text);

    var codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_match, lang, code) {
      var langAttr = lang ? ' class="language-' + lang + '"' : '';
      var idx = codeBlocks.length;
      codeBlocks.push('<pre><code' + langAttr + '>' + code + '</code></pre>');
      return '\n%%CODEBLOCK_' + idx + '%%\n';
    });

    var inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, function(_match, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code>' + code + '</code>');
      return '%%INLINECODE_' + idx + '%%';
    });

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

      if (line.trim().match(/^%%CODEBLOCK_\d+%%$/)) {
        if (inList) { result.push('</' + listType + '>'); inList = false; listType = ''; }
        if (inBlockquote) { result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); blockquoteLines = []; inBlockquote = false; }
        if (inTable) { result.push(buildTable(tableLines)); tableLines = []; inTable = false; }
        result.push(line.trim());
        continue;
      }

      if (inBlockquote && !line.match(/^&gt;\s?/)) {
        result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>');
        blockquoteLines = [];
        inBlockquote = false;
      }

      if (inTable && !line.match(/^\|/)) {
        result.push(buildTable(tableLines));
        tableLines = [];
        inTable = false;
      }

      if (inList && line.trim() !== '' && !line.match(/^(\s*[-*+]\s|\s*\d+\.\s)/)) {
        result.push('</' + listType + '>');
        inList = false;
        listType = '';
      }

      if (line.match(/^\s*([-*_]\s*){3,}$/)) {
        if (inList) { result.push('</' + listType + '>'); inList = false; listType = ''; }
        result.push('<hr>');
        continue;
      }

      var headingMatch = line.match(/^(#{1,6})\s+(.*?)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var headingText = processInline(headingMatch[2]);
        result.push('<h' + level + '>' + headingText + '</h' + level + '>');
        continue;
      }

      if (line.match(/^&gt;\s?/)) {
        inBlockquote = true;
        blockquoteLines.push(line.replace(/^&gt;\s?/, ''));
        continue;
      }

      if (line.match(/^\|/)) {
        if (!inTable) { inTable = true; tableLines = []; }
        tableLines.push(line);
        continue;
      }

      var ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) { result.push('</' + listType + '>'); }
          result.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        var liContent = ulMatch[2];
        var taskMatch = liContent.match(/^\[([ xX])\]\s+(.*)/);
        if (taskMatch) {
          var checked = taskMatch[1] !== ' ' ? ' checked' : '';
          result.push('<li class="task-list-item"><input type="checkbox" class="task-checkbox" data-line="' + i + '"' + checked + '> ' + processInline(taskMatch[2]) + '</li>');
        } else {
          result.push('<li>' + processInline(liContent) + '</li>');
        }
        continue;
      }

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

      if (line.trim() === '') { continue; }
      result.push('<p>' + processInline(line) + '</p>');
    }

    if (inBlockquote) { result.push('<blockquote>' + processBlockquoteContent(blockquoteLines) + '</blockquote>'); }
    if (inTable) { result.push(buildTable(tableLines)); }
    if (inList) { result.push('</' + listType + '>'); }

    var output = result.join('\n');

    for (var cb = 0; cb < codeBlocks.length; cb++) {
      output = output.replace('%%CODEBLOCK_' + cb + '%%', codeBlocks[cb]);
    }
    for (var ic = 0; ic < inlineCodes.length; ic++) {
      output = output.replace(new RegExp('%%INLINECODE_' + ic + '%%', 'g'), inlineCodes[ic]);
    }

    return output;
  }

  function processBlockquoteContent(lines) {
    return lines.map(function(line) {
      if (line.trim() === '') return '';
      return '<p>' + processInline(line) + '</p>';
    }).join('\n');
  }

  function sanitizeUrl(url) {
    var trimmed = url.trim().toLowerCase();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:')) {
      return url.trim();
    }
    return '';
  }

  function processInline(text) {
    if (!text) return '';
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(_match, alt, url) {
      var safe = sanitizeUrl(url);
      if (!safe) return alt;
      return '<img src="' + safe + '" alt="' + alt + '" style="max-width:100%;">';
    });
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_match, linkText, url) {
      var safe = sanitizeUrl(url);
      if (!safe) return linkText;
      return '<a href="' + safe + '">' + linkText + '</a>';
    });
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return text;
  }

  function buildTable(lines) {
    if (lines.length < 2) {
      return lines.map(function(l) { return '<p>' + processInline(l) + '</p>'; }).join('\n');
    }
    var headerCells = parseTableRow(lines[0]);
    var alignments = [];
    var isSeparator = lines[1].replace(/\s/g, '').match(/^\|?(:?-+:?\|)*:?-+:?\|?$/);
    var bodyStartIndex = 1;
    if (isSeparator) {
      bodyStartIndex = 2;
      var sepCells = parseTableRow(lines[1]);
      for (var a = 0; a < sepCells.length; a++) {
        var cell = sepCells[a].trim();
        if (cell.match(/^:-+:$/)) { alignments.push('center'); }
        else if (cell.match(/^-+:$/)) { alignments.push('right'); }
        else { alignments.push('left'); }
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

  function parseTableRow(row) {
    var trimmed = row.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|');
  }

  function renderActivity(activity, owner, repo) {
    const timeAgo = formatTimeAgo(activity.created_at);
    const userAvatar = activity.user ? activity.user.avatar_url : '';
    const userLogin = activity.user ? activity.user.login : 'Unknown';

    if (activity.type === 'comment') {
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${userAvatar}" alt="" onerror="this.style.display='none'">
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

    if (activity.type === 'timeline') {
      return `
        <div class="activity-item">
          <img class="activity-avatar" src="${userAvatar}" alt="" onerror="this.style.display='none'">
          <div class="activity-content">
            <div class="activity-header">
              <span class="activity-user">${escapeHtml(userLogin)}</span>
              <span class="activity-event">${renderTimelineEvent(activity)}</span>
              <span class="activity-time">${timeAgo}</span>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  function renderTimelineEvent(activity) {
    if (!activity.event) return 'performed an action';

    const events = {
      'close': 'closed this issue',
      'reopen': 'reopened this issue',
      'comment': 'commented',
      'label': 'added/removed a label',
      'milestone': 'changed the milestone',
      'assignees': 'changed assignees',
      'lock': 'locked this issue',
      'unlock': 'unlocked this issue',
      'pin': 'pinned this issue',
      'unpin': 'unpinned this issue',
      'commit_ref': 'referenced this issue',
      'issue_ref': 'referenced this issue',
      'comment_ref': 'referenced this issue',
      'pull_ref': 'referenced this issue',
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
      'closed': 'closed this issue',
      'reopened': 'reopened this issue',
      'commented': 'commented',
      'labeled': 'added a label',
      'unlabeled': 'removed a label',
      'milestoned': 'added to a milestone',
      'demilestoned': 'removed from a milestone',
      'referenced': 'referenced this issue',
      'assigned': 'was assigned',
      'unassigned': 'was unassigned',
      'locked': 'locked this issue',
      'unlocked': 'unlocked this issue',
      'pinned': 'pinned this issue',
      'unpinned': 'unpinned this issue',
      'renamed': 'changed the title',
      'change_title': 'changed the title',
      'transferred': 'transferred this issue'
    };

    var eventText = events[activity.event] || activity.event;

    if (activity.event === 'label' && activity.label) {
      eventText = 'changed label <strong>' + escapeHtml(activity.label.name || '') + '</strong>';
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

    return eventText;
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

  function applyTheme(theme) {
    console.log('[Forgejo Issue Webview] Applying theme:', theme);
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
  console.log('[Forgejo Issue Webview] Starting initialization');
  init();
})();
