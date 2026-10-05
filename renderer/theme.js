// Follows the OS theme until the user picks one; the choice is shared across windows.
(function () {
  const KEY = 'ss-theme';
  const root = document.documentElement;
  const apply = () => {
    let t = null;
    try { t = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    if (t === 'light' || t === 'dark') root.dataset.theme = t;
    else delete root.dataset.theme;
  };
  apply();
  addEventListener('storage', (e) => { if (e.key === KEY) apply(); });
  window.toggleTheme = () => {
    const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = root.dataset.theme || (sysDark ? 'dark' : 'light');
    try { localStorage.setItem(KEY, cur === 'dark' ? 'light' : 'dark'); } catch { /* ignore */ }
    apply();
  };
})();
