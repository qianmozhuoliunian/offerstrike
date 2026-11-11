// The application uses one shared notification area for brief feedback.
export function createToast(escapeHtml) {
  const activeToasts = new Set();

  function toast(message, type = 'info') {
    let toaster = document.querySelector('#sonner-toaster');
    if (!toaster) {
      toaster = document.createElement('div');
      toaster.id = 'sonner-toaster';
      toaster.className = 'sonner-toaster';
      toaster.setAttribute('role', 'region');
      toaster.setAttribute('aria-label', '系统通知');
      document.body.appendChild(toaster);
    }

    const el = document.createElement('div');
    el.className = `sonner-toast ${type}`;
    el.setAttribute('role', 'status');
    const icon = type === 'success'
      ? '<polyline points="20 6 9 17 4 12"></polyline>'
      : type === 'error'
        ? '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'
        : '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>';
    el.innerHTML = `
      <span class="sonner-icon ${type}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${icon}</svg></span>
      <div class="sonner-content"><span class="sonner-title">${escapeHtml(message)}</span></div>`;
    toaster.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));

    let timer;
    let remaining = 3000;
    let startTime = Date.now();
    const dismiss = () => {
      if (el.classList.contains('dismissing')) return;
      clearTimeout(timer);
      el.classList.remove('visible');
      el.classList.add('dismissing');
      activeToasts.delete(controls);
      setTimeout(() => el.remove(), 340);
    };
    const startTimer = () => {
      startTime = Date.now();
      clearTimeout(timer);
      timer = setTimeout(dismiss, remaining);
    };
    const pauseTimer = () => {
      clearTimeout(timer);
      remaining -= Date.now() - startTime;
    };
    const controls = {startTimer, pauseTimer};
    el.onclick = dismiss;
    el.onmouseenter = pauseTimer;
    el.onmouseleave = startTimer;
    activeToasts.add(controls);
    startTimer();
  }

  toast.success = message => toast(message, 'success');
  toast.error = message => toast(message, 'error');
  document.addEventListener('visibilitychange', () => {
    activeToasts.forEach(item => document.hidden ? item.pauseTimer() : item.startTimer());
  });
  return toast;
}
