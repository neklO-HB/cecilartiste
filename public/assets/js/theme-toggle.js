document.addEventListener('DOMContentLoaded', () => {
    const switcher = document.getElementById('theme-switch');
    if (!switcher) {
        return;
    }

    const root = document.documentElement;
    const valueLabel = switcher.querySelector('.theme-switch__value');
    let audioContext = null;
    let whooshBuffer = null;

    function getAudioContext() {
        if (typeof window === 'undefined') {
            return null;
        }
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            return null;
        }
        if (!audioContext) {
            try {
                audioContext = new AudioContextClass();
            } catch (error) {
                audioContext = null;
            }
        }
        return audioContext;
    }

    function createWhooshBuffer(context) {
        if (!context) {
            return null;
        }
        const duration = 0.6;
        const sampleRate = context.sampleRate;
        const length = Math.floor(sampleRate * duration);
        const buffer = context.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            const progress = i / length;
            const fadeOut = Math.pow(1 - progress, 2);
            const turbulence = Math.sin(progress * Math.PI);
            data[i] = (Math.random() * 2 - 1) * fadeOut * (0.6 + 0.4 * turbulence);
        }
        return buffer;
    }

    function playWhoosh() {
        const context = getAudioContext();
        if (!context) {
            return;
        }
        if (context.state === 'suspended') {
            context.resume().catch(() => {});
        }
        if (!whooshBuffer) {
            whooshBuffer = createWhooshBuffer(context);
        }
        if (!whooshBuffer) {
            return;
        }
        const source = context.createBufferSource();
        source.buffer = whooshBuffer;
        source.playbackRate.value = 1.25;

        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(850, context.currentTime);
        filter.Q.setValueAtTime(0.8, context.currentTime);

        const gain = context.createGain();
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, context.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.6);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(context.destination);

        source.start();
    }
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

        if (animate) {
            playWhoosh();
        }

        if (persist) {
            localStorage.setItem('cecilartiste-theme', themeId);
        }
    }

    const stored = localStorage.getItem('cecilartiste-theme');
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
