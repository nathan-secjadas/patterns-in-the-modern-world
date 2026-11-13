(function () {
    const canvas = document.getElementById('pattern-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const $ = (id) => document.getElementById(id);
    const listEl = $('transform-list');
    const zoomLabel = $('zoom-label');
    const statusEl = $('gen-status');

    /* ---------- 2D affine matrices: [a, b, c, d, e, f] (same layout as canvas) ----------
       x' = a*x + c*y + e,   y' = b*x + d*y + f
       Math coordinates: origin at canvas centre, +y points up, +angle is counter-clockwise. */
    const IDENTITY = [1, 0, 0, 1, 0, 0];

    // mul(m, n) = apply n first, then m
    const mul = (m, n) => [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5]
    ];

    const translation = (tx, ty) => [1, 0, 0, 1, tx, ty];
    const rad = (deg) => (deg * Math.PI) / 180;

    // run matrix m about the point (px, py) instead of the origin
    const aboutPoint = (m, px, py) =>
        mul(translation(px, py), mul(m, translation(-px, -py)));

    const rotationMatrix = (deg) => {
        const t = rad(deg), c = Math.cos(t), s = Math.sin(t);
        return [c, s, -s, c, 0, 0];
    };

    // reflection across a line through (px, py) with direction angle phi (degrees)
    const reflectionMatrix = (phiDeg, px, py) => {
        const t = 2 * rad(phiDeg);
        return aboutPoint([Math.cos(t), Math.sin(t), Math.sin(t), -Math.cos(t), 0, 0], px, py);
    };

    /* ---------- transformation definitions ----------
       fields: the base parameters.
       steps:  how a parameter changes each repeat
               'add' -> arithmetic sequence (p, p+d, p+2d, ...)
               'mul' -> geometric sequence   (p, p*r, p*r^2, ...) */
    const TYPES = {
        translate: {
            label: 'translation',
            fields: [
                { key: 'dx', label: 'move right by', def: 60 },
                { key: 'dy', label: 'move up by', def: 0 }
            ],
            steps: [
                { key: 'ddx', label: 'extra right per repeat', def: 0 },
                { key: 'ddy', label: 'extra up per repeat', def: 0 }
            ],
            matrix: (v, i) => translation(v.dx + i * v.ddx, v.dy + i * v.ddy)
        },
        reflect: {
            label: 'reflection',
            fields: [
                {
                    key: 'axis', label: 'axis', type: 'select', def: 'vertical',
                    options: [
                        ['vertical', 'vertical (x = c)'],
                        ['horizontal', 'horizontal (y = c)'],
                        ['diagonal', 'diagonal (y = x + c)'],
                        ['anti', 'other diagonal (y = -x + c)']
                    ]
                },
                { key: 'offset', label: 'offset (c)', def: 0 }
            ],
            steps: [],
            matrix: (v) => {
                switch (v.axis) {
                    case 'vertical':   return reflectionMatrix(90, v.offset, 0);
                    case 'horizontal': return reflectionMatrix(0, 0, v.offset);
                    case 'diagonal':   return reflectionMatrix(45, 0, v.offset);
                    default:           return reflectionMatrix(135, 0, v.offset);
                }
            }
        },
        rotate: {
            label: 'rotation',
            fields: [
                { key: 'angle', label: 'angle (degrees, counterclockwise)', def: 30 },
                { key: 'cx', label: 'center x', def: 0 },
                { key: 'cy', label: 'center y', def: 0 }
            ],
            steps: [
                { key: 'dAngle', label: 'extra turn per repeat', def: 0 }
            ],
            matrix: (v, i) => aboutPoint(rotationMatrix(v.angle + i * v.dAngle), v.cx, v.cy)
        },
        dilate: {
            label: 'dilation',
            fields: [
                { key: 'k', label: 'scale', def: 1.1 },
                { key: 'cx', label: 'center x', def: 0 },
                { key: 'cy', label: 'center y', def: 0 }
            ],
            steps: [
                { key: 'ratio', label: 'scale ratio per repeat', def: 1 }
            ],
            matrix: (v, i) => {
                const k = v.k * Math.pow(v.ratio, i);
                return aboutPoint([k, 0, 0, k, 0, 0], v.cx, v.cy);
            }
        }
    };

    /* ---------- state ---------- */
    let transforms = []; // { type, values: {key: value} }

    /* ---------- live updating ----------
       any change to an option redraws the pattern shortly after (so typing a number
       does not redraw on every key press). a change also means the settings no longer
       match whichever template was last clicked, so that highlight is cleared. */
    let genTimer = null;
    function scheduleGenerate() {
        clearTimeout(genTimer);
        genTimer = setTimeout(() => generate(), 120);
    }
    function changed() {
        selectTemplate(null);
        scheduleGenerate();
    }

    /* ---------- transformation list UI ---------- */
    function makeField(t, f) {
        const label = document.createElement('label');
        label.className = 'gen-field';
        label.append(f.label);

        let input;
        if (f.type === 'select') {
            input = document.createElement('select');
            f.options.forEach(([value, text]) => {
                const o = document.createElement('option');
                o.value = value;
                o.textContent = text;
                input.appendChild(o);
            });
            input.value = t.values[f.key];
            input.addEventListener('input', () => { t.values[f.key] = input.value; });
        } else {
            input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.value = t.values[f.key];
            input.addEventListener('input', () => {
                const n = parseFloat(input.value);
                t.values[f.key] = Number.isFinite(n) ? n : f.def;
            });
        }
        label.appendChild(input);
        return label;
    }

    function renderList() {
        listEl.innerHTML = '';

        if (!transforms.length) {
            const p = document.createElement('p');
            p.className = 'gen-hint';
            p.textContent = 'nothing here yet. choose a type above and press add.';
            listEl.appendChild(p);
            return;
        }

        transforms.forEach((t, idx) => {
            const def = TYPES[t.type];
            const card = document.createElement('div');
            card.className = 'transform-card';

            const head = document.createElement('div');
            head.className = 'transform-card-head';
            const title = document.createElement('span');
            title.textContent = `${idx + 1}. ${def.label}`;
            head.appendChild(title);

            const btns = document.createElement('div');
            btns.className = 'transform-card-btns';
            [
                ['↑', 'move up', () => move(idx, -1), idx === 0],
                ['↓', 'move down', () => move(idx, 1), idx === transforms.length - 1],
                ['x', 'remove', () => remove(idx), false]
            ].forEach(([text, aria, fn, disabled]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = text;
                b.setAttribute('aria-label', aria);
                b.disabled = disabled;
                b.addEventListener('click', fn);
                btns.appendChild(b);
            });
            head.appendChild(btns);
            card.appendChild(head);

            def.fields.forEach((f) => card.appendChild(makeField(t, f)));

            if (def.steps.length) {
                const sub = document.createElement('div');
                sub.className = 'transform-steps-label';
                sub.textContent = t.type === 'dilate'
                    ? 'multiplies by the same ratio each repeat (geometric). 1 keeps it steady.'
                    : 'adds the same amount each repeat (arithmetic). 0 keeps it steady.';
                card.appendChild(sub);
                def.steps.forEach((f) => card.appendChild(makeField(t, f)));
            }

            listEl.appendChild(card);
        });
    }

    function addTransform(type) {
        const def = TYPES[type];
        const values = {};
        [...def.fields, ...def.steps].forEach((f) => { values[f.key] = f.def; });
        transforms.push({ type, values });
        renderList();
        changed();
    }

    function move(idx, dir) {
        const j = idx + dir;
        if (j < 0 || j >= transforms.length) return;
        [transforms[idx], transforms[j]] = [transforms[j], transforms[idx]];
        renderList();
        changed();
    }

    function remove(idx) {
        transforms.splice(idx, 1);
        renderList();
        changed();
    }

    /* ---------- view (pan + zoom) and scene ---------- */
    const MIN_ZOOM = 0.05;
    const MAX_ZOOM = 10;

    // pan is in canvas pixels, measured from the canvas centre; zoom 1 = 100%
    const view = { zoom: 1, x: 0, y: 0 };

    // what generate() produced: kept so the canvas can be redrawn when the view changes
    // { shape, size, sx, sy, marker, items: [{ matrix, color }] }
    let scene = null;

    // math coords (origin at centre, +y up) -> canvas pixels, including pan and zoom
    const worldMatrix = () => [view.zoom, 0, 0, -view.zoom, W / 2 + view.x, H / 2 + view.y];

    /* ---------- drawing ---------- */
    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function lerpColor(a, b, t) {
        const ca = hexToRgb(a), cb = hexToRgb(b);
        const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }

    function drawBackground() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        if (!$('show-axes').checked) return;

        // grid in screen space; spacing doubles as you zoom out so it never turns to mush
        let step = 50;
        while (step * view.zoom < 25) step *= 2;

        const ox = W / 2 + view.x;   // screen position of the origin
        const oy = H / 2 + view.y;
        const left = (0 - ox) / view.zoom;
        const right = (W - ox) / view.zoom;
        const top = (oy - 0) / view.zoom;
        const bottom = (oy - H) / view.zoom;

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(180, 222, 255, 0.5)';
        ctx.beginPath();
        for (let wx = Math.floor(left / step) * step; wx <= right; wx += step) {
            const px = Math.round(ox + wx * view.zoom) + 0.5;
            ctx.moveTo(px, 0); ctx.lineTo(px, H);
        }
        for (let wy = Math.floor(bottom / step) * step; wy <= top; wy += step) {
            const py = Math.round(oy - wy * view.zoom) + 0.5;
            ctx.moveTo(0, py); ctx.lineTo(W, py);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 133, 154, 0.7)';
        ctx.beginPath();
        ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, H);
        ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(W, Math.round(oy) + 0.5);
        ctx.stroke();
    }

    // pointy-top regular hexagon; `size` is the distance from corner to opposite corner
    function hexagonCorners(sx, sy, size) {
        const r = size / 2;
        return [0, 1, 2, 3, 4, 5].map((k) => {
            const a = Math.PI / 2 + (k * Math.PI) / 3;
            return [sx + r * Math.cos(a), sy + r * Math.sin(a)];
        });
    }

    function drawShape(sc, item, c = ctx, base = worldMatrix()) {
        const own = Math.sqrt(Math.abs(item.matrix[0] * item.matrix[3] - item.matrix[1] * item.matrix[2]));
        if (!Number.isFinite(own) || own < 1e-3 || own > 1e4) return; // degenerate or absurdly large

        const m = mul(base, item.matrix);
        const onScreen = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); // total scale incl. zoom
        c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

        const { shape, size, sx, sy } = sc;
        c.beginPath();
        if (shape === 'square') {
            c.rect(sx - size / 2, sy - size / 2, size, size);
        } else if (shape === 'triangle') {
            c.moveTo(sx, sy + size * 0.577);
            c.lineTo(sx - size / 2, sy - size * 0.289);
            c.lineTo(sx + size / 2, sy - size * 0.289);
            c.closePath();
        } else if (shape === 'hexagon') {
            hexagonCorners(sx, sy, size).forEach(([px, py], k) => {
                if (k) c.lineTo(px, py);
                else c.moveTo(px, py);
            });
            c.closePath();
        } else {
            c.arc(sx, sy, size / 2, 0, Math.PI * 2);
        }
        c.fillStyle = item.color;
        c.globalAlpha = 0.8;
        c.fill();
        c.globalAlpha = 1;
        c.lineWidth = 1.5 / onScreen; // stays 1.5px on screen at any zoom
        c.strokeStyle = 'rgba(80, 40, 60, 0.7)';
        c.stroke();

        // a small off-centre dot so reflections and rotations are visible on symmetric shapes
        if (sc.marker) {
            c.beginPath();
            c.arc(sx + size * 0.18, sy + size * 0.12, size * 0.06, 0, Math.PI * 2);
            c.fillStyle = 'rgba(255, 255, 255, 0.95)';
            c.fill();
        }
    }

    function redraw() {
        drawBackground();
        if (scene) scene.items.forEach((item) => drawShape(scene, item));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
    }

    // coalesce bursts of pan/zoom events into one redraw per frame
    let redrawQueued = false;
    function requestRedraw() {
        if (redrawQueued) return;
        redrawQueued = true;
        requestAnimationFrame(() => { redrawQueued = false; redraw(); });
    }

    /* ---------- generate / resets ---------- */
    /* ---------- palette (color 1, color 2, ...) ---------- */
    const MIN_COLORS = 2;
    const MAX_COLORS = 8;
    // used for the first two colors, and for each color added after that
    const DEFAULT_COLORS = ['#ff859a', '#b4deff', '#d7b0ff', '#c7f0d8', '#e3c9ff', '#ffc2a1', '#a8e6e0', '#f5a8d1'];
    const HEX = /^#[0-9a-f]{6}$/i;
    const colorList = $('color-list');

    function addColorRow(hex) {
        const n = colorList.children.length + 1;
        const label = document.createElement('label');
        label.className = 'gen-field';
        label.append(`color ${n}`);
        const input = document.createElement('input');
        input.type = 'color';
        input.value = hex;
        label.appendChild(input);
        colorList.appendChild(label);
    }

    function updateColorButtons() {
        const n = colorList.children.length;
        $('add-color-btn').disabled = n >= MAX_COLORS;
        $('remove-color-btn').disabled = n <= MIN_COLORS;
    }

    function setPalette(colors) {
        colorList.innerHTML = '';
        const list = colors.slice(0, MAX_COLORS);
        while (list.length < MIN_COLORS) list.push(DEFAULT_COLORS[list.length]);
        list.forEach(addColorRow);
        updateColorButtons();
    }

    const getPalette = () => [...colorList.querySelectorAll('input')].map((el) => el.value);

    // templates saved before there were more than two colors only have colorStart / colorEnd
    function normalizeColors(t) {
        const raw = Array.isArray(t.colors) ? t.colors : [t.colorStart, t.colorEnd];
        const ok = raw.filter((c) => typeof c === 'string' && HEX.test(c));
        return ok.length >= MIN_COLORS ? ok.slice(0, MAX_COLORS) : DEFAULT_COLORS.slice(0, MIN_COLORS);
    }

    /* ---------- color templates ---------- */
    const COLOR_TEMPLATES = [
        {
            group: 'site',
            items: [
                { id: 'site',    name: 'site colors',     colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'] },
                { id: 'sparkle', name: 'cursor sparkles', colors: ['#ffc1ea', '#fba8d1', '#fffdfc', '#c3f1ff', '#b6f0f1'] }
            ]
        },
        {
            group: 'special',
            items: [
                { id: 'pride-rainbow', name: 'rainbow',
                  colors: ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'] },
                { id: 'pride-gay',     name: 'happy',
                  colors: ['#078d70', '#26ceaa', '#98e8c1', '#ffffff', '#7bade2', '#5049cc', '#3d1a78'] },
                { id: 'pride-lesbian', name: 'sappho',
                  colors: ['#d52d00', '#ef7627', '#ff9a56', '#ffffff', '#d162a4', '#b55690', '#a30262'] },
                { id: 'pride-trans',   name: 'blåhaj',
                  colors: ['#5bcefa', '#f5a9b8', '#ffffff', '#f5a9b8', '#5bcefa'] },
                { id: 'pride-bisexual', name: 'by the lake',
                  colors: ['#D60270', '#9B4F96', '#0038A8']}
            ],
            tip: 'for the flag stripes, try row stripes with one row per color.'
        },
        {
            group: 'other',
            items: [
                { id: 'pastel',  name: 'pastel pink and blue', colors: ['#ff859a', '#b4deff'] },
                { id: 'candy',   name: 'candy',                colors: ['#ff9ec7', '#ffd3a5', '#fff3b0', '#c7f0d8', '#b4deff', '#e3c9ff'] },
                { id: 'sunset',  name: 'sunset',               colors: ['#ffd56b', '#ff9a56', '#ff6b6b', '#8a4fff'] },
                { id: 'ocean',   name: 'ocean',                colors: ['#e0f7ff', '#7fd1f5', '#2f8fd8', '#1b4f8f'] },
                { id: 'forest',  name: 'forest',               colors: ['#e6f4d7', '#a8d98a', '#4fa36b', '#1f5f4a'] },
                { id: 'bw',      name: 'black and white',      colors: ['#000000', '#ffffff'] }
            ]
        }
    ];

    const paletteSelect = $('palette-select');
    const paletteNote = $('palette-note');

    COLOR_TEMPLATES.forEach((g) => {
        const og = document.createElement('optgroup');
        og.label = g.group;
        g.items.forEach((t) => {
            const o = document.createElement('option');
            o.value = t.id;
            o.textContent = t.name;
            og.appendChild(o);
        });
        paletteSelect.appendChild(og);
    });

    // choosing a color template swaps the palette straight away (the pattern redraws on its own)
    paletteSelect.addEventListener('change', () => {
        let found = null;
        COLOR_TEMPLATES.forEach((g) => g.items.forEach((t) => {
            if (t.id === paletteSelect.value) found = { t, tip: g.tip };
        }));
        if (!found) return;
        setPalette(found.t.colors);
        paletteNote.textContent = `using "${found.t.name}".${found.tip ? ' ' + found.tip : ''}`;
    });

    /* ---------- color by ---------- */
    // grouped for the menu; each option gets a one-line explanation under it
    const COLOR_MODES = [
        {
            group: 'gradients (blend through your colors)',
            modes: [
                { id: 'seq',      label: 'along each row',            hint: 'blends from the first shape in a row to the last one.' },
                { id: 'row',      label: 'down the rows',             hint: 'blends from the first row to the last. each row is one shade.' },
                { id: 'diagonal', label: 'diagonal',                  hint: 'blends from one corner of the grid to the opposite corner.' },
                { id: 'reverse',  label: 'opposite diagonal',         hint: 'blends along the other diagonal.' },
                { id: 'radial',   label: 'distance from the center',  hint: 'shapes near the middle get the first color, far ones get the last.' },
                { id: 'size',     label: 'shape size',                hint: 'the smallest shapes get the first color, the biggest get the last. try it with a dilation.' }
            ]
        },
        {
            group: 'repeating (cycle through your colors)',
            modes: [
                { id: 'stripes-cols', label: 'column stripes',    hint: 'each column takes the next color, then it starts over.' },
                { id: 'stripes-rows', label: 'row stripes',       hint: 'each row takes the next color, then it starts over.' },
                { id: 'diag-stripes', label: 'diagonal stripes',  hint: 'colors repeat along the diagonals.' },
                { id: 'checker',      label: 'checkerboard',      hint: 'alternates color 1 and color 2 like a chess board.' }
            ]
        },
        {
            group: 'random and rainbow',
            modes: [
                { id: 'pick',    label: 'random pick',   hint: 'each shape gets one of your colors at random.' },
                { id: 'scatter', label: 'random blend',  hint: 'each shape gets a random shade between your colors.' },
                { id: 'rainbow', label: 'rainbow',       hint: 'ignores your colors and runs through the whole rainbow.' }
            ]
        }
    ];

    const modeSelect = $('color-mode');
    const modeHint = $('color-mode-hint');

    COLOR_MODES.forEach((g) => {
        const og = document.createElement('optgroup');
        og.label = g.group;
        g.modes.forEach((m) => {
            const o = document.createElement('option');
            o.value = m.id;
            o.textContent = m.label;
            og.appendChild(o);
        });
        modeSelect.appendChild(og);
    });

    function updateModeHint() {
        const all = COLOR_MODES.flatMap((g) => g.modes);
        const m = all.find((x) => x.id === modeSelect.value);
        modeHint.textContent = m ? m.hint : '';
    }

    function setColorMode(id) {
        modeSelect.value = id;
        if (modeSelect.value !== id) modeSelect.value = 'seq'; // unknown id from an old template
        updateModeHint();
    }

    /* ---------- coloring ---------- */
    const rainbow = (t) => `hsl(${Math.round(t * 300)}, 80%, 72%)`;

    // repeatable "random" number in [0, 1) for shape number k
    const scatter = (k) => {
        const v = Math.sin((k + 1) * 12.9898) * 43758.5453;
        return v - Math.floor(v);
    };

    function colorItems(sc, mode, palette, repeats, rows) {
        const n = palette.length;

        // blend through the palette in order: 0 = color 1, 1 = last color
        const blend = (t) => {
            if (n < 2) return palette[0];
            const x = Math.min(1, Math.max(0, t)) * (n - 1);
            const k = Math.min(n - 2, Math.floor(x));
            return lerpColor(palette[k], palette[k + 1], x - k);
        };
        const cycle = (k) => palette[((k % n) + n) % n];

        const tCol = (it) => it.col / repeats;
        const tRow = (it) => (rows > 1 ? it.row / (rows - 1) : 0);
        const tDiag = (it) => (rows > 1 ? (tCol(it) + tRow(it)) / 2 : tCol(it));

        // these two compare each shape with all the others, so measure everything first
        let measure = null;
        if (mode === 'radial' || mode === 'size') {
            const vals = sc.items.map((it) => {
                const m = it.matrix;
                if (mode === 'size') return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
                return Math.hypot(m[0] * sc.sx + m[2] * sc.sy + m[4], m[1] * sc.sx + m[3] * sc.sy + m[5]);
            });
            const lo = vals.reduce((a, v) => Math.min(a, v), Infinity);
            const hi = vals.reduce((a, v) => Math.max(a, v), -Infinity);
            measure = (k) => (hi > lo ? (vals[k] - lo) / (hi - lo) : 0);
        }

        sc.items.forEach((it, k) => {
            switch (mode) {
                case 'row':          it.color = blend(tRow(it)); break;
                case 'diagonal':     it.color = blend(tDiag(it)); break;
                case 'reverse':      it.color = blend(rows > 1 ? (tCol(it) + 1 - tRow(it)) / 2 : tCol(it)); break;
                case 'radial':
                case 'size':         it.color = blend(measure(k)); break;
                case 'stripes-cols': it.color = cycle(it.col); break;
                case 'stripes-rows': it.color = cycle(it.row); break;
                case 'diag-stripes': it.color = cycle(it.col + it.row); break;
                case 'checker':      it.color = palette[(it.col + it.row) % 2]; break;
                case 'pick':         it.color = palette[Math.floor(scatter(k) * n)]; break;
                case 'scatter':      it.color = blend(scatter(k)); break;
                case 'rainbow':      it.color = rainbow(tDiag(it)); break;
                default:             it.color = blend(tCol(it)); // along each row
            }
        });
    }

    const MAX_SHAPES = 10000; // keeps panning and zooming smooth

    function generate(label) {
        clearTimeout(genTimer);
        const num = (id, fallback) => {
            const n = parseFloat($(id).value);
            return Number.isFinite(n) ? n : fallback;
        };

        const palette = getPalette();
        const colorMode = $('color-mode').value;
        const repeats = Math.min(500, Math.max(1, Math.round(num('repeat-count', 1))));
        let rows = Math.min(200, Math.max(1, Math.round(num('row-count', 1))));
        const rowX = num('row-x', 0);
        const rowY = num('row-y', 0);
        const oddX = num('row-odd-x', 0);

        // stay under the shape cap
        const perRow = repeats + 1;
        let capped = false;
        if (perRow * rows > MAX_SHAPES) {
            rows = Math.max(1, Math.floor(MAX_SHAPES / perRow));
            capped = true;
        }

        const next = {
            shape: $('shape-select').value,
            size: Math.max(1, num('shape-size', 60)),
            sx: num('shape-x', 0),
            sy: num('shape-y', 0),
            marker: $('show-marker').checked,
            items: []
        };

        // one row: copy 0 is the original shape; each repeat applies the whole
        // sequence (in order) to the previous copy
        const rowMatrices = [];
        let cumulative = IDENTITY;
        for (let i = 0; i <= repeats; i++) {
            rowMatrices.push(cumulative);

            let step = IDENTITY;
            transforms.forEach((tr) => {
                step = mul(TYPES[tr.type].matrix(tr.values, i), step);
            });
            cumulative = mul(step, cumulative);
        }

        // the grid: copy the finished row down by the row offset, once per row.
        // odd rows can also be nudged sideways (brick walls, triangle tilings)
        for (let r = 0; r < rows; r++) {
            const rowShift = translation(r * rowX + (r % 2 ? oddX : 0), r * rowY);
            for (let i = 0; i <= repeats; i++) {
                next.items.push({ matrix: mul(rowShift, rowMatrices[i]), col: i, row: r });
            }
        }
        colorItems(next, colorMode, palette, repeats, rows);

        scene = next;
        redraw();

        const total = next.items.length;
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        let msg = transforms.length
            ? `drew ${plural(total, 'shape')} (${plural(perRow, 'column')} by ${plural(rows, 'row')}).`
            : 'there are no transformations yet, so every copy sits on top of the original. add one above.';
        if (capped) msg += ` that is a lot of shapes, so rows were limited to ${rows} (${MAX_SHAPES} shapes max).`;
        if (typeof label === 'string') msg = `loaded ${label}. ${msg}`;
        statusEl.textContent = msg;
    }

    // clears only the list of transformations (the drawing stays)
    function resetTransforms() {
        transforms = [];
        renderList();
    }

    /* ---------- templates ----------
       each one fills in every option, then generates.
       shape sizes are chosen so neighbouring copies touch exactly. */
    const TRI_H = Math.sqrt(3) / 2; // height of an equilateral triangle with side 1

    const TEMPLATES = [
        {
            id: 'square-grid',
            group: 'grids and tilings',
            name: 'square grid',
            shape: 'square', size: 50, x: -225, y: 175,
            colors: ['#ff859a', '#ffcbe2', '#b4deff'], colorMode: 'row',
            repeats: 9, rows: 8, rowX: 0, rowY: -50, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 50, dy: 0 } }]
        },
        {
            // 40px squares on a 60px step: a 20px gap both across and down
            id: 'spaced-grid',
            group: 'grids and tilings',
            name: 'spaced grid',
            shape: 'square', size: 40, x: -270, y: 210,
            colors: ['#ff859a', '#ffcbe2', '#b4deff'], colorMode: 'diagonal',
            repeats: 9, rows: 8, rowX: 0, rowY: -60, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 60, dy: 0 } }]
        },
        {
            id: 'checkerboard',
            group: 'grids and tilings',
            name: 'checkerboard',
            shape: 'square', size: 50, x: -175, y: 175,
            colors: ['#ff859a', '#ffffff'], colorMode: 'checker',
            repeats: 7, rows: 8, rowX: 0, rowY: -50, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 50, dy: 0 } }]
        },
        {
            id: 'brick-wall',
            group: 'grids and tilings',
            name: 'brick wall',
            shape: 'square', size: 50, x: -275, y: 175,
            colors: ['#ff859a', '#ffc2cd'], colorMode: 'row',
            repeats: 11, rows: 8, rowX: 0, rowY: -50, oddX: 25,
            transforms: [{ type: 'translate', values: { dx: 50, dy: 0 } }]
        },
        (() => {
            // triangles alternate up/down along a row: reflect across the horizontal line through
            // the middle of the triangle, then slide half a side to the right (a glide reflection)
            const s = 50, y = 230;
            return {
                id: 'triangle-tiling',
                group: 'grids and tilings',
                name: 'triangle tiling',
                shape: 'triangle', size: s, x: -350, y,
                colors: ['#b4deff', '#ff859a'], colorMode: 'diagonal',
                repeats: 28, rows: 11, rowX: 0, rowY: -s * TRI_H, oddX: s / 2,
                transforms: [
                    { type: 'reflect', values: { axis: 'horizontal', offset: y + s * 0.1443 } },
                    { type: 'translate', values: { dx: s / 2, dy: 0 } }
                ]
            };
        })(),
        (() => {
            // pointy-top hexagons: neighbours in a row are sqrt(3) * radius apart, rows are 1.5 * radius
            // apart, and every other row slides over by half a step
            const r = 30, step = Math.sqrt(3) * r, cols = 14, rows = 12;
            const round = (v) => Math.round(v * 100) / 100;
            return {
                id: 'honeycomb',
                group: 'grids and tilings',
                name: 'honeycomb',
                shape: 'hexagon', size: 2 * r,
                x: round(-((cols - 1) * step) / 2 - step / 4), y: round(((rows - 1) * 1.5 * r) / 2),
                colors: ['#ff859a', '#ffcbe2', '#b4deff'], colorMode: 'diagonal',
                repeats: cols - 1, rows, rowX: 0, rowY: -1.5 * r, oddX: round(step / 2),
                transforms: [{ type: 'translate', values: { dx: round(step), dy: 0 } }]
            };
        })(),
        (() => {
            // the same honeycomb with every distance stretched by 1.3, which leaves an even gap
            const r = 24, k = 1.3, step = Math.sqrt(3) * r * k, cols = 13, rows = 11;
            const round = (v) => Math.round(v * 100) / 100;
            return {
                id: 'spaced-honeycomb',
                group: 'grids and tilings',
                name: 'spaced honeycomb',
                shape: 'hexagon', size: 2 * r,
                x: round(-((cols - 1) * step) / 2 - step / 4), y: round(((rows - 1) * 1.5 * r * k) / 2),
                colors: ['#c7f0d8', '#b4deff', '#e3c9ff'], colorMode: 'row',
                repeats: cols - 1, rows, rowX: 0, rowY: round(-1.5 * r * k), oddX: round(step / 2),
                transforms: [{ type: 'translate', values: { dx: round(step), dy: 0 } }]
            };
        })(),
        {
            id: 'rosette',
            group: 'rotations and spirals',
            name: 'rosette',
            shape: 'square', size: 60, x: 110, y: 0,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 30, cx: 0, cy: 0 } }]
        },
        {
            // six hexagons around the middle: a 60 degree turn lands each one exactly on the next
            id: 'hexagon-ring',
            group: 'rotations and spirals',
            name: 'hexagon ring',
            shape: 'hexagon', size: 90, x: 86, y: 0,
            colors: ['#ff859a', '#b4deff', '#ffcbe2'], colorMode: 'stripes-cols',
            repeats: 5, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 60, cx: 0, cy: 0 } }]
        },
        {
            id: 'spiral',
            group: 'rotations and spirals',
            name: 'spiral',
            shape: 'square', size: 14, x: 25, y: 0,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 45, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'rotate', values: { angle: 20, cx: 0, cy: 0 } },
                { type: 'dilate', values: { k: 1.05, cx: 0, cy: 0 } }
            ]
        },
        {
            id: 'hexagon-spiral',
            group: 'rotations and spirals',
            name: 'hexagon spiral',
            shape: 'hexagon', size: 14, x: 22, y: 0,
            colors: ['#ff859a', '#ffcbe2', '#c7f0d8', '#b4deff'], colorMode: 'seq',
            repeats: 40, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'rotate', values: { angle: 25, cx: 0, cy: 0 } },
                { type: 'dilate', values: { k: 1.06, cx: 0, cy: 0 } }
            ]
        },
        {
            id: 'arithmetic',
            group: 'sequences and reflections',
            name: 'growing gaps (arithmetic)',
            shape: 'circle', size: 30, x: -300, y: 0,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 13, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 10, dy: 0, ddx: 4, ddy: 0 } }]
        },
        {
            id: 'geometric',
            group: 'sequences and reflections',
            name: 'growing size (geometric)',
            shape: 'circle', size: 10, x: -300, y: 0,
            colors: ['#b4deff', '#ff859a'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'dilate', values: { k: 1.2, cx: -350, cy: 0 } }]
        },
        {
            id: 'glide',
            group: 'sequences and reflections',
            name: 'glide reflection',
            shape: 'triangle', size: 40, x: -330, y: 25,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'reflect', values: { axis: 'horizontal', offset: 0 } },
                { type: 'translate', values: { dx: 60, dy: 0 } }
            ]
        }
    ];

    let userTemplates = []; // saved by the visitor, filled from localStorage below

    const findTemplate = (id) =>
        TEMPLATES.find((x) => x.id === id) || userTemplates.find((x) => x.id === id);

    function applyTemplate(id) {
        const t = findTemplate(id);
        if (!t) return;

        $('shape-select').value = t.shape;
        $('shape-size').value = t.size;
        $('shape-x').value = t.x;
        $('shape-y').value = t.y;
        setPalette(normalizeColors(t));
        setColorMode(t.colorMode);
        $('repeat-count').value = t.repeats;
        $('row-count').value = t.rows;
        $('row-x').value = t.rowX;
        $('row-y').value = Math.round(t.rowY * 100) / 100;
        $('row-odd-x').value = t.oddX;

        // fresh cards with each transformation's defaults, then the template's values on top
        transforms = [];
        t.transforms.forEach((tr) => {
            const def = TYPES[tr.type];
            const values = {};
            [...def.fields, ...def.steps].forEach((f) => { values[f.key] = f.def; });
            transforms.push({ type: tr.type, values: Object.assign(values, tr.values) });
        });
        renderList();

        // frame the pattern at 100% before drawing
        view.zoom = 1; view.x = 0; view.y = 0;
        generate(t.name);
    }

    /* ---------- save as image ---------- */
    // box (in pattern coordinates) around one shape, or null if it is not drawn
    function itemBounds(sc, item) {
        const m = item.matrix;
        const own = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        if (!Number.isFinite(own) || own < 1e-3 || own > 1e4) return null;

        const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        const { shape, size, sx, sy } = sc;
        const h = size / 2;

        if (shape === 'circle') {
            const [cx, cy] = at(sx, sy);
            const r = h * own;
            return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r };
        }
        let corners;
        if (shape === 'square') {
            corners = [[sx - h, sy - h], [sx + h, sy - h], [sx + h, sy + h], [sx - h, sy + h]];
        } else if (shape === 'hexagon') {
            corners = hexagonCorners(sx, sy, size);
        } else {
            corners = [[sx, sy + size * 0.577], [sx - h, sy - size * 0.289], [sx + h, sy - size * 0.289]];
        }
        const pts = corners.map(([x, y]) => at(x, y));
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        return {
            minX: Math.min(...xs), maxX: Math.max(...xs),
            minY: Math.min(...ys), maxY: Math.max(...ys)
        };
    }

    // draws the whole pattern (not just what is on screen) onto its own canvas and downloads it as a PNG
    function saveImage() {
        if (!scene) {
            statusEl.textContent = 'nothing to save yet.';
            return;
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        scene.items.forEach((item) => {
            const b = itemBounds(scene, item);
            if (!b) return;
            minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
            minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
        });
        if (!Number.isFinite(minX)) {
            statusEl.textContent = 'there is nothing visible to save.';
            return;
        }

        const PAD = 24;        // margin around the pattern, in image pixels
        const MAX_SIDE = 2000; // longest side of the image
        const w = maxX - minX;
        const h = maxY - minY;
        const s = Math.min(4, (MAX_SIDE - 2 * PAD) / Math.max(w, h, 1e-6));

        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.ceil(w * s + 2 * PAD));
        out.height = Math.max(1, Math.ceil(h * s + 2 * PAD));
        const c = out.getContext('2d');

        if (!$('transparent-bg').checked) {
            c.fillStyle = '#ffffff';
            c.fillRect(0, 0, out.width, out.height);
        }

        const base = [s, 0, 0, -s, PAD - s * minX, PAD + s * maxY];
        scene.items.forEach((item) => drawShape(scene, item, c, base));

        out.toBlob((blob) => {
            if (!blob) {
                statusEl.textContent = 'sorry, the image could not be made.';
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'pattern.png';
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            statusEl.textContent = `saved pattern.png (${out.width} by ${out.height} px).`;
        }, 'image/png');
    }

    /* ---------- pan & zoom ---------- */
    const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

    // zoom by `factor`, keeping the point under (cx, cy) (canvas pixels) fixed
    function zoomAt(cx, cy, factor) {
        const z = clampZoom(view.zoom * factor);
        const f = z / view.zoom;
        view.x = (cx - W / 2) - ((cx - W / 2) - view.x) * f;
        view.y = (cy - H / 2) - ((cy - H / 2) - view.y) * f;
        view.zoom = z;
        requestRedraw();
    }

    // CSS pixels -> canvas pixels (the canvas is scaled to fit its container)
    function toCanvas(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
    }

    const pointers = new Map(); // active pointers: drag with one, pinch with two
    let pinchDist = 0;

    const pointerDist = () => {
        const [a, b] = [...pointers.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.classList.add('dragging');
        if (pointers.size === 2) pinchDist = pointerDist();
    });

    canvas.addEventListener('pointermove', (e) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        pointers.set(e.pointerId, cur);

        if (pointers.size === 1) {
            const k = W / canvas.getBoundingClientRect().width;
            view.x += (cur.x - prev.x) * k;
            view.y += (cur.y - prev.y) * k;
            requestRedraw();
        } else if (pointers.size === 2) {
            const d = pointerDist();
            const [a, b] = [...pointers.values()];
            const mid = toCanvas((a.x + b.x) / 2, (a.y + b.y) / 2);
            if (pinchDist > 0) zoomAt(mid.x, mid.y, d / pinchDist);
            pinchDist = d;
        }
    });

    const endPointer = (e) => {
        pointers.delete(e.pointerId);
        pinchDist = 0;
        if (!pointers.size) canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault(); // zoom the canvas, don't scroll the page
        const p = toCanvas(e.clientX, e.clientY);
        zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    $('zoom-in-btn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.25));
    $('zoom-out-btn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.25));
    $('reset-view-btn').addEventListener('click', () => {
        view.zoom = 1; view.x = 0; view.y = 0;
        requestRedraw();
    });

    /* ---------- wiring ---------- */
    $('add-transform').addEventListener('click', () => addTransform($('transform-select').value));
    $('save-image-btn').addEventListener('click', saveImage);

    /* ---------- template sidebar: pick one, then press apply ---------- */
    const STORE_KEY = 'patternGenerator.userTemplates';
    const SHAPES = ['square', 'triangle', 'hexagon', 'circle'];

    const templateToggle = $('template-toggle');
    const templateBody = $('template-body');
    const defaultList = $('template-list-default');
    const userList = $('template-list-user');
    const userEmpty = $('template-empty');
    const noteEl = $('template-note');
    const nameInput = $('template-name');
    let selectedTemplate = null; // the template whose settings are currently on screen, if untouched

    const isValidTemplate = (t) =>
        t && typeof t.id === 'string' && typeof t.name === 'string' &&
        SHAPES.includes(t.shape) && Array.isArray(t.transforms) &&
        t.transforms.every((tr) => tr && TYPES[tr.type] && tr.values && typeof tr.values === 'object');

    function loadUserTemplates() {
        try {
            const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
            return Array.isArray(data)
                ? data.filter(isValidTemplate).map((t) => Object.assign({}, t, { colors: normalizeColors(t) }))
                : [];
        } catch (err) {
            return []; // storage blocked or corrupted: start empty
        }
    }

    function storeUserTemplates() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(userTemplates));
            return true;
        } catch (err) {
            return false;
        }
    }

    // everything the options panels currently hold
    function readSettings() {
        const n = (id, fallback) => {
            const v = parseFloat($(id).value);
            return Number.isFinite(v) ? v : fallback;
        };
        return {
            shape: $('shape-select').value,
            size: n('shape-size', 60),
            x: n('shape-x', 0),
            y: n('shape-y', 0),
            colors: getPalette(),
            colorMode: $('color-mode').value,
            repeats: n('repeat-count', 1),
            rows: n('row-count', 1),
            rowX: n('row-x', 0),
            rowY: n('row-y', 0),
            oddX: n('row-odd-x', 0)
        };
    }

    function say(text) {
        noteEl.textContent = text;
    }

    function selectTemplate(id) {
        selectedTemplate = id;
        document.querySelectorAll('.template-item').forEach((el) => {
            el.setAttribute('aria-pressed', String(el.dataset.id === id));
        });
    }

    function renderGroup(listEl, items, removable) {
        listEl.innerHTML = '';
        items.forEach((t) => {
            const li = document.createElement('li');
            li.className = 'template-row';

            const pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'template-item';
            pick.dataset.id = t.id;
            pick.textContent = t.name;
            pick.setAttribute('aria-pressed', String(t.id === selectedTemplate));
            // one click fills in every option and draws the pattern
            pick.addEventListener('click', () => {
                applyTemplate(t.id);
                selectTemplate(t.id);
                say(`applied "${t.name}".`);
            });
            li.appendChild(pick);

            if (removable) {
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'template-delete';
                del.textContent = 'x';
                del.setAttribute('aria-label', `delete ${t.name}`);
                del.addEventListener('click', () => deleteTemplate(t.id));
                li.appendChild(del);
            }
            listEl.appendChild(li);
        });
    }

    function renderTemplates() {
        // default templates sit under small headings, in the order they are listed above
        defaultList.innerHTML = '';
        [...new Set(TEMPLATES.map((t) => t.group || 'other'))].forEach((g) => {
            const heading = document.createElement('h4');
            heading.className = 'template-subheading';
            heading.textContent = g;
            const ul = document.createElement('ul');
            ul.className = 'template-list';
            renderGroup(ul, TEMPLATES.filter((t) => (t.group || 'other') === g), false);
            defaultList.append(heading, ul);
        });
        renderGroup(userList, userTemplates, true);
        userEmpty.hidden = userTemplates.length > 0;
    }

    function saveTemplate() {
        const name = nameInput.value.trim() || `my template ${userTemplates.length + 1}`;
        const t = Object.assign({ id: `user-${Date.now()}`, name }, readSettings(), {
            transforms: transforms.map((tr) => ({ type: tr.type, values: Object.assign({}, tr.values) }))
        });
        userTemplates.push(t);
        const stored = storeUserTemplates();
        nameInput.value = '';
        selectedTemplate = t.id;
        renderTemplates();
        say(stored
            ? `saved "${name}".`
            : `saved "${name}", but only until you close this page (your browser blocked storage).`);
    }

    function deleteTemplate(id) {
        const t = userTemplates.find((x) => x.id === id);
        userTemplates = userTemplates.filter((x) => x.id !== id);
        storeUserTemplates();
        if (selectedTemplate === id) selectedTemplate = null;
        renderTemplates();
        say(t ? `deleted "${t.name}".` : '');
    }

    templateToggle.addEventListener('click', () => {
        const open = templateToggle.getAttribute('aria-expanded') !== 'true';
        templateToggle.setAttribute('aria-expanded', String(open));
        templateBody.hidden = !open;
        $('template-arrow').textContent = open ? '-' : '+';
    });

    $('save-template-btn').addEventListener('click', saveTemplate);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveTemplate();
    });

    userTemplates = loadUserTemplates();
    renderTemplates();

    /* ---------- toolbar: show / hide panels ---------- */
    const PANELS = {
        options:   { el: document.querySelector('.generator-controls'), label: 'options' },
        templates: { el: document.querySelector('.template-panel'),     label: 'templates' },
        zoom:      { el: document.querySelector('.canvas-controls'),    label: 'zoom' }
    };

    document.querySelectorAll('.toolbar-btn[data-panel]').forEach((btn) => {
        const panel = PANELS[btn.dataset.panel];
        btn.addEventListener('click', () => {
            const show = panel.el.hidden; // currently hidden -> show it
            panel.el.hidden = !show;
            btn.setAttribute('aria-expanded', String(show));
            btn.textContent = `${show ? 'hide' : 'show'} ${panel.label}`;
        });
    });

    /* ---------- tutorial ---------- */
    const TUTORIAL_KEY = 'patternGenerator.tutorialSeen';

    const TUTORIAL_STEPS = [
        {
            title: 'welcome!',
            text: 'this is a demonstration of math as a science of patterns. start with one shape, apply transformations, and repeat it to build patterns like the ones in the gallery.',
            tip: 'the four transformations are: translation, reflection, rotation and dilation.'
        },
        {
            title: '1. pick a shape',
            text: 'choose a square, triangle, hexagon or circle, then set its size and where it starts. the middle of the canvas is the point (0, 0).',
            tip: 'the direction dot is off by default. turn it on to see how a shape flips or turns.'
        },
        {
            title: '2. add transformations',
            text: 'translation slides a shape, reflection mirrors it with respect to a certain axis, rotation turns it, and dilation scales it (bigger/smaller). add as many as you like. they run from top to bottom, each one building on the last.',
            tip: 'use the arrows on each card to change the order in which the transformations are applied.'
        },
        {
            title: 'growing patterns',
            text: 'most transformations can change a little more on every repeat. adding the same amount each time makes an arithmetic sequence, and multiplying by the same ratio makes a geometric sequence.',
            tip: 'leave these at 0 (or 1 for scale) to keep every repeat the same.'
        },
        {
            title: '3. repeat and make grids',
            text: 'choose how many times the sequence repeats. for a grid, set the number of rows and a row offset, and the finished row is copied downward.',
            tip: 'for gaps between shapes, make the step bigger than the size.'
        },
        {
            title: '4. choose colors',
            text: 'start with two colors and add more if you like, or pick a color template such as the site colors or a pride flag. gradients blend through your colors in order, and repeating patterns cycle through them. the color by menu explains each option as you pick it.',
            tip: 'with three or more colors, try row stripes or diagonal stripes.'
        },
        {
            title: 'explore and save',
            text: 'the pattern redraws by itself every time you change an option, so there is nothing to press. drag the canvas to move around, and scroll or pinch to zoom. save image downloads the whole pattern as a PNG.',
            tip: 'every options panel has its own reset button, and reset all in the toolbar puts everything back to the start.'
        },
        {
            title: 'templates and toolbar',
            text: 'open templates on the canvas and click one to load a ready-made pattern, or save your own settings to use again later. the toolbar under the title bar can hide the options, templates and zoom panels, or reset everything at once.',
            tip: 'you can bring this tutorial back any time with the tutorial button.'
        }
    ];

    const tutorialOverlay = $('tutorial-overlay');
    const tutorialBack = $('tutorial-back');
    const tutorialNext = $('tutorial-next');
    const tutorialDots = $('tutorial-dots');
    let tutorialStep = 0;
    let focusBeforeTutorial = null;

    TUTORIAL_STEPS.forEach(() => {
        const dot = document.createElement('span');
        dot.className = 'tutorial-dot';
        tutorialDots.appendChild(dot);
    });

    function showTutorialStep(n) {
        const last = TUTORIAL_STEPS.length - 1;
        tutorialStep = Math.min(last, Math.max(0, n));
        const step = TUTORIAL_STEPS[tutorialStep];

        $('tutorial-count').textContent = `step ${tutorialStep + 1} of ${TUTORIAL_STEPS.length}`;
        $('tutorial-title').textContent = step.title;
        $('tutorial-text').textContent = step.text;
        $('tutorial-tip').textContent = step.tip ? `tip: ${step.tip}` : '';
        $('tutorial-tip').hidden = !step.tip;

        tutorialDots.querySelectorAll('.tutorial-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === tutorialStep);
        });
        tutorialBack.disabled = tutorialStep === 0;
        tutorialNext.textContent = tutorialStep === last ? 'understood' : 'next';
    }

    function openTutorial() {
        focusBeforeTutorial = document.activeElement;
        showTutorialStep(0);
        tutorialOverlay.hidden = false;
        tutorialNext.focus();
    }

    function closeTutorial() {
        tutorialOverlay.hidden = true;
        try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch (err) { /* storage blocked: it will show again next visit */ }
        if (focusBeforeTutorial && focusBeforeTutorial.focus) focusBeforeTutorial.focus();
    }

    tutorialBack.addEventListener('click', () => showTutorialStep(tutorialStep - 1));
    tutorialNext.addEventListener('click', () => {
        if (tutorialStep === TUTORIAL_STEPS.length - 1) closeTutorial();
        else showTutorialStep(tutorialStep + 1);
    });
    $('tutorial-close').addEventListener('click', closeTutorial);
    $('tutorial-btn').addEventListener('click', openTutorial);

    // clicking the dimmed area outside the window also closes it
    tutorialOverlay.addEventListener('click', (e) => {
        if (e.target === tutorialOverlay) closeTutorial();
    });

    tutorialOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTutorial();
        } else if (e.key === 'ArrowRight') {
            showTutorialStep(tutorialStep + 1);
        } else if (e.key === 'ArrowLeft') {
            showTutorialStep(tutorialStep - 1);
        } else if (e.key === 'Tab') {
            // keep keyboard focus inside the window while it is open
            const items = [...tutorialOverlay.querySelectorAll('button:not(:disabled)')];
            const first = items[0];
            const lastItem = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); lastItem.focus();
            } else if (!e.shiftKey && document.activeElement === lastItem) {
                e.preventDefault(); first.focus();
            }
        }
    });

    /* ---------- resets: one in every options panel, plus reset all in the toolbar ---------- */
    const RESET_FIELDS = {
        shape: ['shape-select', 'shape-size', 'shape-x', 'shape-y', 'show-marker', 'show-axes'],
        grid: ['repeat-count', 'row-count', 'row-x', 'row-y', 'row-odd-x'],
        output: ['transparent-bg']
    };

    // what each field held when the page loaded, straight from the html
    const initialFields = {};
    Object.values(RESET_FIELDS).flat().forEach((id) => {
        const el = $(id);
        initialFields[id] = el.type === 'checkbox' ? el.checked : el.value;
    });

    function restoreFields(ids) {
        ids.forEach((id) => {
            const el = $(id);
            if (el.type === 'checkbox') el.checked = initialFields[id];
            else el.value = initialFields[id];
        });
    }

    function resetColors() {
        setPalette(DEFAULT_COLORS.slice(0, MIN_COLORS));
        setColorMode('seq');
        paletteSelect.value = '';
        paletteNote.textContent = '';
    }

    // each one resets its panel and returns what to tell the visitor.
    // the pattern redraws on its own afterwards, so there is nothing to press.
    const PANEL_RESETS = {
        shape: () => {
            restoreFields(RESET_FIELDS.shape);
            return 'shape options reset.';
        },
        transformations: () => {
            resetTransforms();
            return 'transformations cleared.';
        },
        grid: () => {
            restoreFields(RESET_FIELDS.grid);
            return 'repeat and grid options reset.';
        },
        colors: () => {
            resetColors();
            return 'colors reset.';
        },
        output: () => {
            restoreFields(RESET_FIELDS.output);
            return 'saving option reset.';
        }
    };

    document.querySelectorAll('.panel-reset').forEach((btn) => {
        btn.addEventListener('click', () => {
            const message = PANEL_RESETS[btn.dataset.reset]();
            selectTemplate(null);
            generate();
            statusEl.textContent = message;
        });
    });

    // any edit inside the options column redraws the pattern.
    // the controls' own handlers (transformation values, color template) run first.
    const controlsEl = document.querySelector('.generator-controls');
    ['input', 'change'].forEach((type) => {
        controlsEl.addEventListener(type, (e) => {
            const el = e.target;
            if (el.id === 'palette-select') {
                if (type === 'change') changed();
                return;
            }
            if (el.type === 'color') { // a hand-picked color is no longer the chosen template
                paletteSelect.value = '';
                paletteNote.textContent = '';
            }
            // typed numbers and color pickers redraw on 'input'; menus and checkboxes on 'change'
            const onInput = el.type === 'number' || el.type === 'color';
            if ((type === 'input') !== onInput) return;
            changed();
        });
    });

    // everything: every panel, the drawing, and pan / zoom. saved templates and hidden panels stay as they are.
    function resetAll() {
        restoreFields(Object.values(RESET_FIELDS).flat());
        resetTransforms();
        resetColors();
        selectTemplate(null);
        view.zoom = 1; view.x = 0; view.y = 0;
        generate();
        statusEl.textContent = 'everything is back to the start.';
    }

    // a second click within 3 seconds confirms, so one slip does not wipe a pattern
    const resetAllBtn = $('reset-all-btn');
    let resetAllTimer = null;

    function disarmResetAll() {
        clearTimeout(resetAllTimer);
        resetAllTimer = null;
        resetAllBtn.textContent = 'reset all';
        resetAllBtn.classList.remove('is-confirming');
    }

    resetAllBtn.addEventListener('click', () => {
        if (resetAllTimer === null) {
            resetAllBtn.textContent = 'sure? click again';
            resetAllBtn.classList.add('is-confirming');
            statusEl.textContent = 'click reset all again to confirm.';
            resetAllTimer = setTimeout(disarmResetAll, 3000);
            return;
        }
        disarmResetAll();
        resetAll();
    });

    // colors and color-by menu
    setPalette(DEFAULT_COLORS.slice(0, MIN_COLORS));
    setColorMode('seq');
    modeSelect.addEventListener('change', updateModeHint);
    $('add-color-btn').addEventListener('click', () => {
        const n = colorList.children.length;
        if (n < MAX_COLORS) {
            // pick the first default color that is not already in the palette
            const used = new Set(getPalette().map((c) => c.toLowerCase()));
            addColorRow(DEFAULT_COLORS.find((c) => !used.has(c)) || DEFAULT_COLORS[n % DEFAULT_COLORS.length]);
        }
        updateColorButtons();
    });
    $('remove-color-btn').addEventListener('click', () => {
        if (colorList.children.length > MIN_COLORS) colorList.lastElementChild.remove();
        updateColorButtons();
    });

    renderList();
    generate(); // draw the starting shape right away

    // first visit: show the tutorial
    let tutorialSeen = false;
    try { tutorialSeen = localStorage.getItem(TUTORIAL_KEY) === '1'; } catch (err) { /* treat as first visit */ }
    if (!tutorialSeen) openTutorial();
})();