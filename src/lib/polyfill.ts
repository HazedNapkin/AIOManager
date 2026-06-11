if (typeof crypto === 'undefined') {
    // @ts-expect-error - polyfill for non-standard window property
    window.crypto = {};
}
