(function() {
  const vscode = acquireVsCodeApi();

  const form = document.getElementById('create-issue-form');
  const titleInput = document.getElementById('title');
  const bodyInput = document.getElementById('body');
  const labelsInput = document.getElementById('labels');
  const assigneesInput = document.getElementById('assignees');
  const milestoneInput = document.getElementById('milestone');
  const dueDateInput = document.getElementById('due-date');
  const submitBtn = document.getElementById('submit-btn');
  const errorEl = document.getElementById('error');
  const successEl = document.getElementById('success');

  function init() {
    setupEventListeners();
    setupMessageHandler();
    vscode.postMessage({ type: 'ready' });
    titleInput.focus();
  }

  function setupEventListeners() {
    form.addEventListener('submit', event => {
      event.preventDefault();
      clearMessages();

      const title = titleInput.value.trim();
      if (!title) {
        showError('Title is required.');
        titleInput.focus();
        return;
      }

      const labels = parseNumberList(labelsInput.value, 'Labels');
      if (labels === null) {
        labelsInput.focus();
        return;
      }

      const milestone = parseOptionalNumber(milestoneInput.value, 'Milestone');
      if (milestone === null) {
        milestoneInput.focus();
        return;
      }

      vscode.postMessage({
        type: 'createIssue',
        data: {
          title,
          body: bodyInput.value.trim(),
          labels,
          assignees: parseTextList(assigneesInput.value),
          milestone,
          dueDate: dueDateInput.value || undefined
        }
      });
    });
  }

  function setupMessageHandler() {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'theme':
          document.body.dataset.theme = message.theme;
          break;
        case 'submitting':
          setSubmitting(message.show);
          break;
        case 'error':
          showError(message.message);
          break;
        case 'created':
          showSuccess('Issue #' + message.number + ' created: ' + message.title);
          form.reset();
          titleInput.focus();
          break;
      }
    });
  }

  function parseTextList(value) {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function parseNumberList(value, fieldName) {
    const items = parseTextList(value);
    const numbers = [];

    for (const item of items) {
      const parsed = Number(item);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        showError(fieldName + ' must contain positive numeric IDs.');
        return null;
      }
      numbers.push(parsed);
    }

    return numbers;
  }

  function parseOptionalNumber(value, fieldName) {
    if (!value.trim()) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      showError(fieldName + ' must be a positive numeric ID.');
      return null;
    }

    return parsed;
  }

  function setSubmitting(show) {
    submitBtn.disabled = show;
    submitBtn.textContent = show ? 'Creating...' : 'Create Issue';
    titleInput.disabled = show;
    bodyInput.disabled = show;
    labelsInput.disabled = show;
    assigneesInput.disabled = show;
    milestoneInput.disabled = show;
    dueDateInput.disabled = show;
  }

  function clearMessages() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    successEl.style.display = 'none';
    successEl.textContent = '';
  }

  function showError(message) {
    successEl.style.display = 'none';
    successEl.textContent = '';
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  function showSuccess(message) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    successEl.textContent = message;
    successEl.style.display = 'block';
  }

  init();
})();
