document.addEventListener('DOMContentLoaded', () => {
    const switcher = document.getElementById('theme-switch');
    if (!switcher) {
        return;
    }

    const root = document.documentElement;
    const valueLabel = switcher.querySelector('.theme-switch__value');
    const THEMES = [
        { id: 'vibrant', label: 'Vibrant' },
        { id: 'aurora', label: 'Aurora' },
        { id: 'nocturne', label: 'Nocturne' },
        { id: 'solaire', label: 'Solaire' }
    ];
    const transitionDuration = 650;

    function updateLabel(themeId) {
        if (!valueLabel) {
            return;
        }
        const theme = THEMES.find(t => t.id === themeId);
        valueLabel.textContent = theme ? theme.label : themeId;
    }

    function applyTheme(themeId, { persist = true, animate = true } = {}) {
        const availableThemes = THEMES.map(theme => theme.id);
        if (!availableThemes.includes(themeId)) {
            themeId = THEMES[0].id;
        }

        if (animate) {
            root.classList.add('theme-transition');
            switcher.classList.add('theme-switch--animating');
            window.setTimeout(() => {
                root.classList.remove('theme-transition');
                switcher.classList.remove('theme-switch--animating');
            }, transitionDuration);
        }

        availableThemes.forEach(theme => root.classList.remove('theme-' + theme));
        root.classList.add('theme-' + themeId);
        switcher.setAttribute('data-theme', themeId);
        updateLabel(themeId);

        if (persist) {
            localStorage.setItem('cecile-theme', themeId);
        }
    }

    const stored = localStorage.getItem('cecile-theme');
    if (stored) {
        applyTheme(stored, { animate: false });
    } else {
        const current = THEMES.find(theme => root.classList.contains('theme-' + theme.id));
        applyTheme(current ? current.id : THEMES[0].id, { animate: false, persist: false });
    }

    switcher.addEventListener('click', () => {
        const activeTheme = THEMES.find(theme => root.classList.contains('theme-' + theme.id)) || THEMES[0];
        const currentIndex = THEMES.indexOf(activeTheme);
        const nextTheme = THEMES[(currentIndex + 1) % THEMES.length];
        applyTheme(nextTheme.id);
    });
});
