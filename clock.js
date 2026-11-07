(function () {
    const timeEl = document.getElementById('clock-time');
    const dateEl = document.getElementById('clock-date');
    if (!timeEl || !dateEl) return;

    const pad = (n) => String(n).padStart(2, '0');

    function tick() {
        const now = new Date();
        timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });
    }

    tick();
    setInterval(tick, 1000);
})();