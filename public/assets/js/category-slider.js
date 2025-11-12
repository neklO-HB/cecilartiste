(function () {
    'use strict';

    const sliders = document.querySelectorAll('[data-category-slider]');
    if (!sliders.length) {
        return;
    }

    const motionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const prefersReducedMotion = () => motionQuery ? motionQuery.matches : false;

    sliders.forEach((slider) => {
        const list = slider.querySelector('[data-slider-list]');
        if (!list) {
            return;
        }

        const items = Array.from(list.querySelectorAll('.category-viewer__item'));
        if (!items.length) {
            return;
        }

        const prevBtn = slider.querySelector('[data-slider-prev]');
        const nextBtn = slider.querySelector('[data-slider-next]');
        const indicator = slider.querySelector('[data-slider-indicator]');
        const status = slider.querySelector('[data-slider-status]');
        const total = items.length;

        let currentIndex = 0;
        let scrollTicking = false;

        slider.classList.toggle('is-single', total <= 1);

        const setButtonState = (button, disabled) => {
            if (!button) {
                return;
            }

            button.disabled = disabled;
            button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        };

        const updateStatus = () => {
            if (!status) {
                return;
            }

            if (total <= 1) {
                status.textContent = 'Une photo est affichée dans la galerie.';
            } else {
                status.textContent = `Photo ${currentIndex + 1} sur ${total}`;
            }
        };

        const updateProgress = () => {
            if (!indicator) {
                return;
            }

            const progress = total <= 1 ? 1 : (currentIndex + 1) / total;
            indicator.style.setProperty('--slider-progress', progress.toString());
        };

        const updateActiveClasses = () => {
            items.forEach((item, index) => {
                item.classList.toggle('is-active', index === currentIndex);
            });
        };

        const updateBoundaries = () => {
            const tolerance = 2;
            const maxScroll = list.scrollWidth - list.clientWidth;
            const canScroll = maxScroll > tolerance;

            slider.classList.toggle('has-scroll', canScroll);

            const atStart = !canScroll || list.scrollLeft <= tolerance;
            const atEnd = !canScroll || list.scrollLeft >= maxScroll - tolerance;

            slider.classList.toggle('is-at-start', atStart);
            slider.classList.toggle('is-at-end', atEnd);

            const disablePrev = total <= 1 || atStart;
            const disableNext = total <= 1 || atEnd;

            setButtonState(prevBtn, disablePrev);
            setButtonState(nextBtn, disableNext);
        };

        const updateUI = () => {
            updateActiveClasses();
            updateStatus();
            updateProgress();
            requestAnimationFrame(updateBoundaries);
        };

        const getScrollBehavior = () => (prefersReducedMotion() ? 'auto' : 'smooth');

        const scrollToIndex = (index) => {
            const target = items[index];
            if (!target) {
                return;
            }

            target.scrollIntoView({
                behavior: getScrollBehavior(),
                block: 'nearest',
                inline: 'center'
            });
        };

        const setActive = (index) => {
            const normalized = Math.max(0, Math.min(index, total - 1));
            if (normalized === currentIndex) {
                updateUI();
                return;
            }

            currentIndex = normalized;
            updateUI();
        };

        const showNext = () => {
            if (currentIndex >= total - 1) {
                setActive(currentIndex);
                return;
            }

            const targetIndex = Math.min(currentIndex + 1, total - 1);
            setActive(targetIndex);
            scrollToIndex(targetIndex);
        };

        const showPrevious = () => {
            if (currentIndex <= 0) {
                setActive(currentIndex);
                return;
            }

            const targetIndex = Math.max(currentIndex - 1, 0);
            setActive(targetIndex);
            scrollToIndex(targetIndex);
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                const observedIndex = items.indexOf(entry.target);
                if (observedIndex !== -1) {
                    currentIndex = observedIndex;
                    updateUI();
                }
            });
        }, {
            root: list,
            threshold: 0.6
        });

        items.forEach((item) => observer.observe(item));

        if (prevBtn) {
            prevBtn.addEventListener('click', showPrevious);
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', showNext);
        }

        slider.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                showNext();
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                showPrevious();
            }
        });

        list.addEventListener('scroll', () => {
            if (scrollTicking) {
                return;
            }

            scrollTicking = true;
            requestAnimationFrame(() => {
                updateBoundaries();
                scrollTicking = false;
            });
        });

        const updateFromResize = () => {
            updateBoundaries();
        };

        if (typeof ResizeObserver === 'function') {
            const resizeObserver = new ResizeObserver(updateFromResize);
            resizeObserver.observe(list);
        } else {
            window.addEventListener('resize', updateFromResize);
        }

        updateUI();
        scrollToIndex(currentIndex);
    });
})();
