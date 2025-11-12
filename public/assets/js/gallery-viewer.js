(function () {
    'use strict';

    const lightbox = document.getElementById('gallery-lightbox');
    if (!lightbox) {
        return;
    }

    const items = Array.from(document.querySelectorAll('.category-viewer__item'));
    if (!items.length) {
        return;
    }

    const triggers = items
        .map((item) => item.querySelector('.category-viewer__trigger'))
        .filter(Boolean);

    if (!triggers.length) {
        return;
    }

    const overlay = lightbox.querySelector('[data-gallery-close]');
    const dialog = lightbox.querySelector('.gallery-lightbox__dialog');
    const imageEl = lightbox.querySelector('.gallery-lightbox__image');
    const descriptionEl = lightbox.querySelector('.gallery-lightbox__description');
    const counterEl = lightbox.querySelector('.gallery-lightbox__counter');
    const closeBtn = lightbox.querySelector('.gallery-lightbox__close');
    const prevBtn = lightbox.querySelector('.gallery-lightbox__nav--prev');
    const nextBtn = lightbox.querySelector('.gallery-lightbox__nav--next');

    if (!overlay || !dialog || !imageEl || !descriptionEl || !counterEl || !closeBtn || !prevBtn || !nextBtn) {
        return;
    }

    let currentIndex = 0;
    let previousFocus = null;

    const total = items.length;

    function focusElement(element) {
        if (!element || typeof element.focus !== 'function') {
            return;
        }

        try {
            element.focus({ preventScroll: true });
        } catch (error) {
            element.focus();
        }
    }

    function getItemData(index) {
        const item = items[index];
        if (!item) {
            return null;
        }

        return {
            src: item.dataset.photoSrc || '',
            alt: item.dataset.photoAlt || 'Photographie du portfolio',
            description: item.dataset.photoDescription || ''
        };
    }

    function updateDisplay(index) {
        const data = getItemData(index);
        if (!data) {
            return;
        }

        imageEl.src = data.src;
        imageEl.alt = data.alt || 'Photographie du portfolio';

        if (data.description) {
            descriptionEl.textContent = data.description;
            descriptionEl.style.display = '';
        } else {
            descriptionEl.textContent = '';
            descriptionEl.style.display = 'none';
        }

        counterEl.textContent = `${index + 1} / ${total}`;
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeLightbox();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showNext();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showPrevious();
        } else if (event.key === 'Tab') {
            maintainFocus(event);
        }
    }

    function maintainFocus(event) {
        const focusable = Array.from(dialog.querySelectorAll('button'));
        if (!focusable.length) {
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function openLightbox(index) {
        currentIndex = index;
        previousFocus = document.activeElement;

        updateDisplay(currentIndex);

        lightbox.hidden = false;
        lightbox.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => {
            lightbox.classList.add('is-open');
        });
        document.body.classList.add('is-lightbox-open');

        document.addEventListener('keydown', handleKeydown);
        focusElement(closeBtn);
    }

    function closeLightbox() {
        lightbox.classList.remove('is-open');
        lightbox.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('is-lightbox-open');
        document.removeEventListener('keydown', handleKeydown);

        const onTransitionEnd = () => {
            lightbox.hidden = true;
        };

        lightbox.addEventListener('transitionend', onTransitionEnd, { once: true });
        window.setTimeout(() => {
            if (!lightbox.hidden) {
                lightbox.hidden = true;
            }
        }, 250);

        focusElement(previousFocus);
    }

    function showNext() {
        currentIndex = (currentIndex + 1) % total;
        updateDisplay(currentIndex);
    }

    function showPrevious() {
        currentIndex = (currentIndex - 1 + total) % total;
        updateDisplay(currentIndex);
    }

    triggers.forEach((trigger, index) => {
        trigger.addEventListener('click', () => openLightbox(index));
    });

    overlay.addEventListener('click', closeLightbox);
    closeBtn.addEventListener('click', closeLightbox);
    nextBtn.addEventListener('click', showNext);
    prevBtn.addEventListener('click', showPrevious);
})();
