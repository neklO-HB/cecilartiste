document.addEventListener('DOMContentLoaded', () => {
    const switcher = document.getElementById('theme-switch');
    if (!switcher) {
        return;
    }

    const root = document.documentElement;
    const THEMES = ['vibrant', 'aurora'];

    function applyTheme(theme) {
        THEMES.forEach(t => root.classList.remove('theme-' + t));
        root.classList.add('theme-' + theme);
        localStorage.setItem('cecile-theme', theme);
    }

    const stored = localStorage.getItem('cecile-theme');
    if (stored && THEMES.includes(stored)) {
        applyTheme(stored);
        switcher.classList.toggle('theme-switch--alt', stored !== THEMES[0]);
    }

    switcher.addEventListener('click', () => {
        const current = THEMES.find(theme => root.classList.contains('theme-' + theme)) || THEMES[0];
        const currentIndex = THEMES.indexOf(current);
        const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
        applyTheme(nextTheme);
        switcher.classList.toggle('theme-switch--alt', nextTheme !== THEMES[0]);
    });
});
