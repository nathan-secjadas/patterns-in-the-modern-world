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
    const generateBtn = $('generate-btn');
    const pendingNote = $('pending-note');

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

    const POINT_OPTIONS = [
        ['own', "shape's own center"],
        ['origin', 'origin (0, 0)'],
        ['point', 'custom point']
    ];

    const pivotOf = (mode, x, y, here) => {
        if (mode === 'own') return [here.x, here.y];
        if (mode === 'origin') return [0, 0];
        return [x, y];
    };

    /* ---------- transformation definitions ---------- */
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
            label: 'reflection (mirror)',
            fields: [
                {
                    key: 'axis', label: 'axis direction', type: 'select', def: 'vertical',
                    options: [
                        ['vertical', 'vertical'],
                        ['horizontal', 'horizontal'],
                        ['diagonal', 'diagonal (y = x)'],
                        ['anti', 'other diagonal (y = -x)'],
                        ['custom', 'custom angle']
                    ]
                },
                {
                    key: 'angle', label: 'axis angle (degrees)', def: 45,
                    showIf: (v) => v.axis === 'custom'
                },
                {
                    key: 'through', label: 'axis passes through', type: 'select', def: 'origin',
                    options: POINT_OPTIONS
                },
                { key: 'px', label: 'point x', def: 0, showIf: (v) => v.through === 'point' },
                { key: 'py', label: 'point y', def: 0, showIf: (v) => v.through === 'point' }
            ],
            steps: [],
            matrix: (v, i, here) => {
                const phi = { vertical: 90, horizontal: 0, diagonal: 45, anti: 135 }[v.axis];
                const [px, py] = pivotOf(v.through, v.px, v.py, here);
                return reflectionMatrix(phi === undefined ? v.angle : phi, px, py);
            }
        },
        rotate: {
            label: 'rotation (turn)',
            fields: [
                { key: 'angle', label: 'angle (degrees, counterclockwise)', def: 30 },
                {
                    key: 'about', label: 'rotate about', type: 'select', def: 'own',
                    options: POINT_OPTIONS
                },
                { key: 'cx', label: 'center x', def: 0, showIf: (v) => v.about === 'point' },
                { key: 'cy', label: 'center y', def: 0, showIf: (v) => v.about === 'point' }
            ],
            steps: [
                { key: 'dAngle', label: 'extra turn per repeat', def: 0 }
            ],
            matrix: (v, i, here) => {
                const [cx, cy] = pivotOf(v.about, v.cx, v.cy, here);
                return aboutPoint(rotationMatrix(v.angle + i * v.dAngle), cx, cy);
            }
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

    function setDirty(dirty) {
        generateBtn.classList.toggle('is-pending', dirty);
        pendingNote.textContent = dirty ? 'Changes not yet drawn.' : '';
    }
    const changed = () => setDirty(true);

    /* ---------- shape list (mixing shapes) ---------- */
    const MIN_SHAPES_COUNT = 1;
    const MAX_SHAPES_COUNT = 8;
    const DEFAULT_SHAPES = ['square'];
    const shapeListEl = $('shape-list');
    const SHAPE_OPTIONS = [
        ['circle', 'circle'],
        ['oval', 'oval'],
        ['triangle', 'triangle'],
        ['square', 'square'],
        ['rectangle', 'rectangle'],
        ['pentagon', 'pentagon'],
        ['hexagon', 'hexagon']
    ];

    function addShapeRow(shapeVal) {
        const n = shapeListEl.children.length + 1;
        const label = document.createElement('label');
        label.className = 'gen-field';
        label.append(`shape ${n}`);
        const select = document.createElement('select');
        SHAPE_OPTIONS.forEach(([value, text]) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = text;
            select.appendChild(o);
        });
        select.value = shapeVal || 'square';
        select.addEventListener('change', () => {
            updateShapeFields();
            changed();
        });
        label.appendChild(select);
        shapeListEl.appendChild(label);
    }

    function updateShapeButtons() {
        const n = shapeListEl.children.length;
        $('add-shape-btn').disabled = n >= MAX_SHAPES_COUNT;
        $('remove-shape-btn').disabled = n <= MIN_SHAPES_COUNT;
    }

    function setShapeList(shapes) {
        shapeListEl.innerHTML = '';
        const list = shapes.slice(0, MAX_SHAPES_COUNT);
        while (list.length < MIN_SHAPES_COUNT) list.push('square');
        list.forEach((s) => addShapeRow(s));
        updateShapeButtons();
        updateShapeFields();
    }

    const getShapeList = () => [...shapeListEl.querySelectorAll('select')].map((el) => el.value);

    function normalizeShapes(t) {
        if (Array.isArray(t.shapes)) return t.shapes;
        if (typeof t.shape === 'string') return [t.shape];
        return ['square'];
    }

    /* ---------- shape modes ---------- */
    const SHAPE_MODES = [
        {
            group: 'shape patterns',
            modes: [
                { id: 'seq',          label: 'along each row',   hint: 'Cycles through your shapes in order along each row.' },
                { id: 'row',          label: 'down the rows',    hint: 'Each row takes the next shape in sequence.' },
                { id: 'diagonal',     label: 'diagonal',         hint: 'Shapes cycle along diagonals.' },
                { id: 'stripes-cols', label: 'column stripes',   hint: 'Each column takes the next shape.' },
                { id: 'stripes-rows', label: 'row stripes',      hint: 'Each row takes the next shape.' },
                { id: 'checker',      label: 'checkerboard',   hint: 'Alternates shape 1 and shape 2 in a checkerboard pattern.' },
                { id: 'pick',         label: 'random pick',      hint: 'Picks a random shape from your mix for each item.' }
            ]
        }
    ];

    const shapeModeSelect = $('shape-mode');
    const shapeModeHint = $('shape-mode-hint');

    SHAPE_MODES.forEach((g) => {
        const og = document.createElement('optgroup');
        og.label = g.group;
        g.modes.forEach((m) => {
            const o = document.createElement('option');
            o.value = m.id;
            o.textContent = m.label;
            og.appendChild(o);
        });
        shapeModeSelect.appendChild(og);
    });

    function updateShapeModeHint() {
        const all = SHAPE_MODES.flatMap((g) => g.modes);
        const m = all.find((x) => x.id === shapeModeSelect.value);
        shapeModeHint.textContent = m ? m.hint : '';
    }

    function setShapeMode(id) {
        shapeModeSelect.value = id;
        if (shapeModeSelect.value !== id) shapeModeSelect.value = 'seq';
        updateShapeModeHint();
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
            input.addEventListener('input', () => {
                t.values[f.key] = input.value;
                if (TYPES[t.type].fields.some((x) => x.showIf)) renderList();
            });
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
            p.textContent = 'No transformations have been added. Choose a type above and press add.';
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

            def.fields
                .filter((f) => !f.showIf || f.showIf(t.values))
                .forEach((f) => card.appendChild(makeField(t, f)));

            if (def.steps.length) {
                const sub = document.createElement('div');
                sub.className = 'transform-steps-label';
                sub.textContent = t.type === 'dilate'
                    ? 'Multiplied by the same ratio on each repeat (geometric sequence). A ratio of 1 keeps it constant.'
                    : 'Increased by the same amount on each repeat (arithmetic sequence). A value of 0 keeps it constant.';
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
    const view = { zoom: 1, x: 0, y: 0 };
    let scene = null;

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

        let step = 50;
        while (step * view.zoom < 25) step *= 2;

        const ox = W / 2 + view.x;
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

    function polygonCorners(sx, sy, size, sides) {
        const r = size / 2;
        return Array.from({ length: sides }, (_, k) => {
            const a = Math.PI / 2 + (k * 2 * Math.PI) / sides;
            return [sx + r * Math.cos(a), sy + r * Math.sin(a)];
        });
    }

    function drawShape(sc, item, c = ctx, base = worldMatrix()) {
        const own = Math.sqrt(Math.abs(item.matrix[0] * item.matrix[3] - item.matrix[1] * item.matrix[2]));
        if (!Number.isFinite(own) || own < 1e-3 || own > 1e4) return;

        const m = mul(base, item.matrix);
        const onScreen = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

        const { size, sx, sy } = sc;
        const shape = item.shape || sc.shape || 'square';
        c.beginPath();
        if (shape === 'square') {
            c.rect(sx - size / 2, sy - size / 2, size, size);
        } else if (shape === 'rectangle') {
            const w = sc.width, h = sc.height;
            const r = Math.min(sc.corner, w / 2, h / 2);
            const x0 = sx - w / 2, y0 = sy - h / 2;
            if (r > 0) {
                c.moveTo(x0 + r, y0);
                c.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
                c.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
                c.arcTo(x0, y0 + h, x0, y0, r);
                c.arcTo(x0, y0, x0 + w, y0, r);
                c.closePath();
            } else {
                c.rect(x0, y0, w, h);
            }
        } else if (shape === 'oval') {
            c.ellipse(sx, sy, sc.width / 2, sc.height / 2, rad(sc.tilt), 0, Math.PI * 2);
        } else if (shape === 'triangle') {
            c.moveTo(sx, sy + size * 0.577);
            c.lineTo(sx - size / 2, sy - size * 0.289);
            c.lineTo(sx + size / 2, sy - size * 0.289);
            c.closePath();
        } else if (shape === 'hexagon' || shape === 'pentagon') {
            polygonCorners(sx, sy, size, shape === 'pentagon' ? 5 : 6).forEach(([px, py], k) => {
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
        if (sc.border) {
            c.lineWidth = 1.5 / onScreen;
            c.strokeStyle = 'rgba(80, 40, 60, 0.7)';
            c.stroke();
        }

        if (sc.marker) {
            const ref = (shape === 'rectangle' || shape === 'oval') ? Math.min(sc.width, sc.height) : size;
            let ox = ref * 0.18, oy = ref * 0.12;
            if (shape === 'oval') {
                const t = rad(sc.tilt), co = Math.cos(t), si = Math.sin(t);
                [ox, oy] = [ox * co - oy * si, ox * si + oy * co];
            }
            c.beginPath();
            c.arc(sx + ox, sy + oy, ref * 0.06, 0, Math.PI * 2);
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

    let redrawQueued = false;
    function requestRedraw() {
        if (redrawQueued) return;
        redrawQueued = true;
        requestAnimationFrame(() => { redrawQueued = false; redraw(); });
    }

    /* ---------- palette ---------- */
    const MIN_COLORS = 2;
    const MAX_COLORS = 8;
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

    function normalizeColors(t) {
        const raw = Array.isArray(t.colors) ? t.colors : [t.colorStart, t.colorEnd];
        const ok = raw.filter((c) => typeof c === 'string' && HEX.test(c));
        return ok.length >= MIN_COLORS ? ok.slice(0, MAX_COLORS) : DEFAULT_COLORS.slice(0, MIN_COLORS);
    }

    /* ---------- color templates ---------- */
    const COLOR_TEMPLATES = [
        {
            group: 'default',
            items: [
                { id: 'site',      name: 'site colors',     colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'] },
                { id: 'sparkle',   name: 'cursor sparkles', colors: ['#ffc1ea', '#fba8d1', '#fffdfc', '#c3f1ff', '#b6f0f1'] },
                { id: 'autumn',    name: 'autumn',          colors: ['#ffe0b2', '#ffb74d', '#e8590c', '#a63d2f', '#5c3b2e'] },
                { id: 'berry',     name: 'berry',           colors: ['#ffd6e8', '#ff8fb8', '#d6336c', '#862e9c', '#3b1f5e'] },
                { id: 'bw',        name: 'black and white', colors: ['#000000', '#ffffff'] },
                { id: 'candy',     name: 'candy',           colors: ['#ff9ec7', '#ffd3a5', '#fff3b0', '#c7f0d8', '#b4deff', '#e3c9ff'] },
                { id: 'coral',     name: 'coral reef',      colors: ['#ff8a80', '#ffb199', '#ffe0a3', '#7fd8c8', '#2e9fb5'] },
                { id: 'earth',     name: 'earth tones',     colors: ['#e9d8a6', '#c9a66b', '#9b6a3f', '#6b705c', '#3d4a3d'] },
                { id: 'forest',    name: 'forest',          colors: ['#e6f4d7', '#a8d98a', '#4fa36b', '#1f5f4a'] },
                { id: 'grayscale', name: 'grayscale',       colors: ['#ffffff', '#d9d9d9', '#a6a6a6', '#6b6b6b', '#262626'] },
                { id: 'lavender',  name: 'lavender',        colors: ['#f3e8ff', '#e3c9ff', '#c8a2f5', '#9d7ae0', '#6b4fb3'] },
                { id: 'neon',      name: 'neon',            colors: ['#ff2e93', '#ffe600', '#39ff14', '#00e5ff', '#7b2eff'] },
                { id: 'ocean',     name: 'ocean',           colors: ['#e0f7ff', '#7fd1f5', '#2f8fd8', '#1b4f8f'] },
                { id: 'retro',     name: 'retro',           colors: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'] },
                { id: 'spring',    name: 'spring',          colors: ['#f8ffd6', '#c7f0d8', '#8ee0b5', '#ffe38a', '#ffb3c1'] },
                { id: 'sunset',    name: 'sunset',          colors: ['#ffd56b', '#ff9a56', '#ff6b6b', '#8a4fff'] },
                { id: 'winter',    name: 'winter',          colors: ['#ffffff', '#d1ebff', '#b4deff', '#7fa8d6', '#3a5a8c'] }
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
            tip: 'For flag stripes, use "row stripes" with one row per color.'
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

    const applyPaletteBtn = $('apply-palette-btn');
    paletteSelect.addEventListener('change', () => {
        applyPaletteBtn.disabled = !paletteSelect.value;
    });

    applyPaletteBtn.addEventListener('click', () => {
        let found = null;
        COLOR_TEMPLATES.forEach((g) => g.items.forEach((t) => {
            if (t.id === paletteSelect.value) found = { t, tip: g.tip };
        }));
        if (!found) return;
        setPalette(found.t.colors);
        paletteNote.textContent = `Colors set to "${found.t.name}".${found.tip ? ' ' + found.tip : ''}`;
        changed();
    });

    /* ---------- color by ---------- */
    const COLOR_MODES = [
        {
            group: 'gradients (blend through your colors)',
            modes: [
                { id: 'seq',      label: 'along each row',            hint: 'Blends from the first shape in each row to the last.' },
                { id: 'row',      label: 'down the rows',             hint: 'Blends from the first row to the last. Each row is a single shade.' },
                { id: 'diagonal', label: 'diagonal',                  hint: 'Blends from one corner of the grid to the opposite corner.' },
                { id: 'reverse',  label: 'opposite diagonal',         hint: 'Blends along the opposite diagonal.' },
                { id: 'radial',   label: 'distance from the center',  hint: 'Shapes near the center take the first color and distant shapes take the last.' },
                { id: 'size',     label: 'shape size',                hint: 'The smallest shapes take the first color and the largest take the last.' }
            ]
        },
        {
            group: 'repeating (cycle through your colors)',
            modes: [
                { id: 'stripes-cols', label: 'column stripes',    hint: 'Each column takes the next color, then the sequence repeats.' },
                { id: 'stripes-rows', label: 'row stripes',       hint: 'Each row takes the next color, then the sequence repeats.' },
                { id: 'diag-stripes', label: 'diagonal stripes',  hint: 'Colors repeat along the diagonals.' },
                { id: 'checker',      label: 'checkerboard',      hint: 'Alternates color 1 and color 2 in a checkerboard arrangement.' }
            ]
        },
        {
            group: 'random and rainbow',
            modes: [
                { id: 'pick',    label: 'random pick',   hint: 'Each shape receives one of the colors at random.' },
                { id: 'scatter', label: 'random blend',  hint: 'Each shape receives a random shade between the colors.' },
                { id: 'rainbow', label: 'rainbow',       hint: 'Ignores the chosen colors and spans the full rainbow.' }
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
        if (modeSelect.value !== id) modeSelect.value = 'seq';
        updateModeHint();
    }

    const rainbow = (t) => `hsl(${Math.round(t * 300)}, 80%, 72%)`;

    const scatter = (k) => {
        const v = Math.sin((k + 1) * 12.9898) * 43758.5453;
        return v - Math.floor(v);
    };

    function colorItems(sc, mode, palette, repeats, rows) {
        const n = palette.length;
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
                default:             it.color = blend(tCol(it));
            }
        });
    }

    const MAX_SHAPES = 10000;

    function generate(label) {
        setDirty(false);
        const num = (id, fallback) => {
            const n = parseFloat($(id).value);
            return Number.isFinite(n) ? n : fallback;
        };

        const palette = getPalette();
        const colorMode = $('color-mode').value;
        const shapes = getShapeList();
        const shapeMode = $('shape-mode').value;
        const repeats = Math.min(500, Math.max(1, Math.round(num('repeat-count', 1))));
        let rows = Math.min(200, Math.max(1, Math.round(num('row-count', 1))));
        const rowX = num('row-x', 0);
        const rowY = num('row-y', 0);
        const oddX = num('row-odd-x', 0);

        const perRow = repeats + 1;
        let capped = false;
        if (perRow * rows > MAX_SHAPES) {
            rows = Math.max(1, Math.floor(MAX_SHAPES / perRow));
            capped = true;
        }

        const next = {
            size: Math.max(1, num('shape-size', 60)),
            width: Math.max(1, num('shape-width', 90)),
            height: Math.max(1, num('shape-height', 50)),
            corner: Math.max(0, num('shape-corner', 0)),
            tilt: num('shape-tilt', 0),
            border: $('show-border').checked,
            sx: num('shape-x', 0),
            sy: num('shape-y', 0),
            marker: $('show-marker').checked,
            items: []
        };

        const rowMatrices = [];
        let cumulative = IDENTITY;
        for (let i = 0; i <= repeats; i++) {
            rowMatrices.push(cumulative);

            let step = IDENTITY;
            transforms.forEach((tr) => {
                const m = mul(step, cumulative);
                const here = {
                    x: m[0] * next.sx + m[2] * next.sy + m[4],
                    y: m[1] * next.sx + m[3] * next.sy + m[5]
                };
                step = mul(TYPES[tr.type].matrix(tr.values, i, here), step);
            });
            cumulative = mul(step, cumulative);
        }

        const nShapes = shapes.length;
        const shapeCycle = (k) => shapes[((k % nShapes) + nShapes) % nShapes];

        for (let r = 0; r < rows; r++) {
            const rowShift = translation(r * rowX + (r % 2 ? oddX : 0), r * rowY);
            for (let i = 0; i <= repeats; i++) {
                const k = r * perRow + i;
                let assignedShape = 'square';
                switch (shapeMode) {
                    case 'row':          assignedShape = shapes[((r % nShapes) + nShapes) % nShapes]; break;
                    case 'diagonal':     assignedShape = shapeCycle(i + r); break;
                    case 'stripes-cols': assignedShape = shapeCycle(i); break;
                    case 'stripes-rows': assignedShape = shapeCycle(r); break;
                    case 'checker':      assignedShape = shapes[(i + r) % nShapes]; break;
                    case 'pick':         assignedShape = shapes[Math.floor(scatter(k) * nShapes)]; break;
                    default:             assignedShape = shapeCycle(i);
                }
                next.items.push({ matrix: mul(rowShift, rowMatrices[i]), col: i, row: r, shape: assignedShape });
            }
        }
        colorItems(next, colorMode, palette, repeats, rows);

        scene = next;
        redraw();

        const total = next.items.length;
        const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        let msg = transforms.length
            ? `Drew ${plural(total, 'shape')} (${plural(perRow, 'column')} by ${plural(rows, 'row')}).`
            : 'No transformations have been added, so every copy overlaps the original. Add one in step 2.';
        if (capped) msg += ` The limit of ${MAX_SHAPES} shapes was reached, so the grid was limited to ${plural(rows, 'row')}.`;
        if (typeof label === 'string') msg = `Loaded "${label}". ${msg}`;
        statusEl.textContent = msg;
    }

    function resetTransforms() {
        transforms = [];
        renderList();
    }

    /* ---------- templates ---------- */
    const TRI_H = Math.sqrt(3) / 2;

    const TEMPLATES = [
        {
            id: 'polka-dots',
            group: 'circles',
            name: 'polka dots',
            shapes: ['circle'], size: 36, x: -330, y: 240,
            colors: ['#ff859a', '#b4deff'], colorMode: 'checker',
            repeats: 11, rows: 9, rowX: 0, rowY: -60, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 60, dy: 0 } }]
        },
        {
            id: 'fish-scales',
            group: 'circles',
            name: 'fish scales',
            shapes: ['circle'], size: 64, x: -368, y: -208,
            colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'], colorMode: 'row',
            repeats: 11, rows: 14, rowX: 0, rowY: 32, oddX: 32,
            transforms: [{ type: 'translate', values: { dx: 64, dy: 0 } }]
        },
        {
            id: 'concentric-circles',
            group: 'circles',
            name: 'concentric circles',
            shapes: ['circle'], size: 560, x: 0, y: 0,
            colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'], colorMode: 'seq',
            repeats: 12, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'dilate', values: { k: 0.85, cx: 0, cy: 0 } }]
        },
        {
            id: 'arithmetic',
            group: 'circles',
            name: 'growing gaps (arithmetic)',
            shapes: ['circle'], size: 30, x: -300, y: 0,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 13, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 10, dy: 0, ddx: 4, ddy: 0 } }]
        },
        {
            id: 'geometric',
            group: 'circles',
            name: 'growing size (geometric)',
            shapes: ['circle'], size: 10, x: -300, y: 0,
            colors: ['#b4deff', '#ff859a'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'dilate', values: { k: 1.2, cx: -350, cy: 0 } }]
        },
        {
            id: 'tilted-ovals',
            group: 'ovals',
            name: 'tilted ovals',
            shapes: ['oval'], size: 50, width: 70, height: 30, corner: 0, tilt: 45, border: true,
            x: -345, y: 225,
            colors: ['#ff859a', '#d7b0ff', '#b4deff'], colorMode: 'diagonal',
            repeats: 11, rows: 10, rowX: 0, rowY: -50, oddX: 30,
            transforms: [{ type: 'translate', values: { dx: 60, dy: 0 } }]
        },
        {
            id: 'nested-ovals',
            group: 'ovals',
            name: 'nested ovals',
            shapes: ['oval'], size: 50, width: 760, height: 480, corner: 0, tilt: 20, border: true,
            x: 0, y: 0,
            colors: ['#b4deff', '#d3dafd', '#ff859a'], colorMode: 'seq',
            repeats: 14, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'dilate', values: { k: 0.88, cx: 0, cy: 0 } }]
        },
        {
            id: 'oval-flower',
            group: 'ovals',
            name: 'oval flower',
            shapes: ['oval'], size: 50, width: 130, height: 44, corner: 0, tilt: 0, border: false,
            x: 75, y: 0,
            colors: ['#ff859a', '#d7b0ff', '#b4deff'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 30, cx: 0, cy: 0 } }]
        },
        {
            id: 'oval-chain',
            group: 'ovals',
            name: 'oval chain',
            shapes: ['oval'], size: 50, width: 80, height: 36, corner: 0, tilt: 40, border: true,
            x: -300, y: 224,
            colors: ['#ff859a', '#b4deff'], colorMode: 'stripes-cols',
            repeats: 10, rows: 8, rowX: 0, rowY: -64, oddX: 0,
            transforms: [
                { type: 'reflect', values: { axis: 'horizontal', through: 'point', px: 0, py: 224 } },
                { type: 'translate', values: { dx: 60, dy: 0 } }
            ]
        },
        (() => {
            const s = 50, y = 230;
            return {
                id: 'triangle-tiling',
                group: 'triangles',
                name: 'triangle tiling',
                shapes: ['triangle'], size: s, x: -350, y,
                colors: ['#b4deff', '#ff859a'], colorMode: 'diagonal',
                repeats: 28, rows: 11, rowX: 0, rowY: -s * TRI_H, oddX: s / 2,
                transforms: [
                    { type: 'reflect', values: { axis: 'horizontal', through: 'point', px: 0, py: y + s * 0.1443 } },
                    { type: 'translate', values: { dx: s / 2, dy: 0 } }
                ]
            };
        })(),
        {
            id: 'triangle-pinwheel',
            group: 'triangles',
            name: 'triangle pinwheel',
            shapes: ['triangle'], size: 90, x: 0, y: 110,
            colors: ['#ff859a', '#ffc2cd', '#b4deff'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 30, cx: 0, cy: 0 } }]
        },
        {
            id: 'glide',
            group: 'triangles',
            name: 'glide reflection',
            shapes: ['triangle'], size: 40, x: -330, y: 25,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'reflect', values: { axis: 'horizontal', through: 'origin' } },
                { type: 'translate', values: { dx: 60, dy: 0 } }
            ]
        },
        {
            id: 'square-grid',
            group: 'squares',
            name: 'square grid',
            shapes: ['square'], size: 50, x: -225, y: 175,
            colors: ['#ff859a', '#ffcbe2', '#b4deff'], colorMode: 'row',
            repeats: 9, rows: 8, rowX: 0, rowY: -50, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 50, dy: 0 } }]
        },
        {
            id: 'spaced-grid',
            group: 'squares',
            name: 'spaced grid',
            shapes: ['square'], size: 40, x: -270, y: 210,
            colors: ['#ff859a', '#ffcbe2', '#b4deff'], colorMode: 'diagonal',
            repeats: 9, rows: 8, rowX: 0, rowY: -60, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 60, dy: 0 } }]
        },
        {
            id: 'checkerboard',
            group: 'squares',
            name: 'checkerboard',
            shapes: ['square'], size: 50, x: -175, y: 175,
            colors: ['#ff859a', '#ffffff'], colorMode: 'checker',
            repeats: 7, rows: 8, rowX: 0, rowY: -50, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 50, dy: 0 } }]
        },
        {
            id: 'brick-wall',
            group: 'squares',
            name: 'brick wall',
            shapes: ['square'], size: 50, x: -275, y: 175,
            colors: ['#ff859a', '#ffc2cd'], colorMode: 'row',
            repeats: 11, rows: 8, rowX: 0, rowY: -50, oddX: 25,
            transforms: [{ type: 'translate', values: { dx: 50, dy: 0 } }]
        },
        {
            id: 'rosette',
            group: 'squares',
            name: 'rosette',
            shapes: ['square'], size: 60, x: 110, y: 0,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 30, cx: 0, cy: 0 } }]
        },
        {
            id: 'spiral',
            group: 'squares',
            name: 'spiral',
            shapes: ['square'], size: 14, x: 25, y: 0,
            colors: ['#ff859a', '#b4deff'], colorMode: 'seq',
            repeats: 45, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'rotate', values: { angle: 20, cx: 0, cy: 0 } },
                { type: 'dilate', values: { k: 1.05, cx: 0, cy: 0 } }
            ]
        },
        {
            id: 'nested-squares',
            group: 'squares',
            name: 'nested squares',
            shapes: ['square'], size: 440, x: 0, y: 0,
            colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'], colorMode: 'seq',
            repeats: 24, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'rotate', values: { angle: 8, cx: 0, cy: 0 } },
                { type: 'dilate', values: { k: 0.9, cx: 0, cy: 0 } }
            ]
        },
        {
            id: 'stripes',
            group: 'rectangles',
            name: 'stripes',
            shapes: ['rectangle'], size: 50, width: 56, height: 440, corner: 0, tilt: 0, border: true,
            x: -330, y: 0,
            colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'], colorMode: 'stripes-cols',
            repeats: 11, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 60, dy: 0 } }]
        },
        {
            id: 'rising-steps',
            group: 'rectangles',
            name: 'rising steps',
            shapes: ['rectangle'], size: 50, width: 60, height: 120, corner: 0, tilt: 0, border: true,
            x: -360, y: -144,
            colors: ['#ff859a', '#d7b0ff', '#b4deff'], colorMode: 'seq',
            repeats: 12, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'translate', values: { dx: 60, dy: 24 } }]
        },
        {
            id: 'rounded-bricks',
            group: 'rectangles',
            name: 'rounded bricks',
            shapes: ['rectangle'], size: 50, width: 80, height: 40, corner: 12, tilt: 0, border: true,
            x: -315, y: 175,
            colors: ['#ff859a', '#ffc2cd', '#b4deff'], colorMode: 'row',
            repeats: 7, rows: 8, rowX: 0, rowY: -50, oddX: 45,
            transforms: [{ type: 'translate', values: { dx: 90, dy: 0 } }]
        },
        {
            id: 'pill-sun',
            group: 'rectangles',
            name: 'pill sun',
            shapes: ['rectangle'], size: 50, width: 100, height: 22, corner: 11, tilt: 0, border: true,
            x: 130, y: 0,
            colors: ['#ff859a', '#ffc2cd', '#b4deff', '#d3dafd'], colorMode: 'stripes-cols',
            repeats: 23, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 15, cx: 0, cy: 0 } }]
        },
        {
            id: 'nested-frames',
            group: 'rectangles',
            name: 'nested frames',
            shapes: ['rectangle'], size: 50, width: 800, height: 560, corner: 40, tilt: 0, border: true,
            x: 0, y: 0,
            colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff'], colorMode: 'seq',
            repeats: 14, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'dilate', values: { k: 0.88, cx: 0, cy: 0 } }]
        },
        {
            id: 'staggered-pentagons',
            group: 'pentagons',
            name: 'staggered pentagons',
            shapes: ['pentagon'], size: 64, x: -378, y: 256,
            colors: ['#ff859a', '#d7b0ff', '#b4deff'], colorMode: 'diagonal',
            repeats: 10, rows: 9, rowX: 0, rowY: -64, oddX: 36,
            transforms: [{ type: 'translate', values: { dx: 72, dy: 0 } }]
        },
        {
            id: 'pentagon-flower',
            group: 'pentagons',
            name: 'pentagon flower',
            shapes: ['pentagon'], size: 120, x: 0, y: 130,
            colors: ['#ff859a', '#ffc2cd', '#d3dafd', '#b4deff', '#b8f0ff'], colorMode: 'stripes-cols',
            repeats: 4, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 72, cx: 0, cy: 0 } }]
        },
        {
            id: 'pentagon-wheel',
            group: 'pentagons',
            name: 'pentagon wheel',
            shapes: ['pentagon'], size: 80, x: 0, y: 150,
            colors: ['#ff859a', '#b4deff'], colorMode: 'rainbow',
            repeats: 17, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 20, cx: 0, cy: 0 } }]
        },
        (() => {
            const r = 30, step = Math.sqrt(3) * r, cols = 14, rows = 12;
            const round = (v) => Math.round(v * 100) / 100;
            return {
                id: 'honeycomb',
                group: 'hexagons',
                name: 'honeycomb',
                shapes: ['hexagon'], size: 2 * r,
                x: round(-((cols - 1) * step) / 2 - step / 4), y: round(((rows - 1) * 1.5 * r) / 2),
                colors: ['#ff859a', '#ffcbe2', '#b4deff'], colorMode: 'diagonal',
                repeats: cols - 1, rows, rowX: 0, rowY: -1.5 * r, oddX: round(step / 2),
                transforms: [{ type: 'translate', values: { dx: round(step), dy: 0 } }]
            };
        })(),
        (() => {
            const r = 24, k = 1.3, step = Math.sqrt(3) * r * k, cols = 13, rows = 11;
            const round = (v) => Math.round(v * 100) / 100;
            return {
                id: 'spaced-honeycomb',
                group: 'hexagons',
                name: 'spaced honeycomb',
                shapes: ['hexagon'], size: 2 * r,
                x: round(-((cols - 1) * step) / 2 - step / 4), y: round(((rows - 1) * 1.5 * r * k) / 2),
                colors: ['#c7f0d8', '#b4deff', '#e3c9ff'], colorMode: 'row',
                repeats: cols - 1, rows, rowX: 0, rowY: round(-1.5 * r * k), oddX: round(step / 2),
                transforms: [{ type: 'translate', values: { dx: round(step), dy: 0 } }]
            };
        })(),
        {
            id: 'hexagon-ring',
            group: 'hexagons',
            name: 'hexagon ring',
            shapes: ['hexagon'], size: 90, x: 86, y: 0,
            colors: ['#ff859a', '#b4deff', '#ffcbe2'], colorMode: 'stripes-cols',
            repeats: 5, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [{ type: 'rotate', values: { angle: 60, cx: 0, cy: 0 } }]
        },
        {
            id: 'hexagon-spiral',
            group: 'hexagons',
            name: 'hexagon spiral',
            shapes: ['hexagon'], size: 14, x: 22, y: 0,
            colors: ['#ff859a', '#ffcbe2', '#c7f0d8', '#b4deff'], colorMode: 'seq',
            repeats: 40, rows: 1, rowX: 0, rowY: 0, oddX: 0,
            transforms: [
                { type: 'rotate', values: { angle: 25, cx: 0, cy: 0 } },
                { type: 'dilate', values: { k: 1.06, cx: 0, cy: 0 } }
            ]
        }
    ];

    let userTemplates = [];

    const findTemplate = (id) =>
        TEMPLATES.find((x) => x.id === id) || userTemplates.find((x) => x.id === id);

    function normalizeTransform(tr) {
        const values = Object.assign({}, tr.values);
        if (tr.type === 'rotate' && values.about === undefined) values.about = 'point';
        if (tr.type === 'reflect' && values.through === undefined) {
            const c = Number.isFinite(values.offset) ? values.offset : 0;
            values.through = 'point';
            values.px = values.axis === 'vertical' ? c : 0;
            values.py = values.axis === 'vertical' ? 0 : c;
        }
        return { type: tr.type, values };
    }

    function applyTemplate(id) {
        const t = findTemplate(id);
        if (!t) return;

        setShapeList(normalizeShapes(t));
        setShapeMode(t.shapeMode || 'seq');
        $('shape-size').value = t.size;
        $('shape-width').value = t.width ?? initialFields['shape-width'];
        $('shape-height').value = t.height ?? initialFields['shape-height'];
        $('shape-corner').value = t.corner ?? initialFields['shape-corner'];
        $('shape-tilt').value = t.tilt ?? initialFields['shape-tilt'];
        $('show-border').checked = t.border ?? true;
        updateShapeFields();
        $('shape-x').value = t.x;
        $('shape-y').value = t.y;
        setPalette(normalizeColors(t));
        paletteSelect.value = '';
        applyPaletteBtn.disabled = true;
        paletteNote.textContent = '';
        setColorMode(t.colorMode);
        $('repeat-count').value = t.repeats;
        $('row-count').value = t.rows;
        $('row-x').value = t.rowX;
        $('row-y').value = Math.round(t.rowY * 100) / 100;
        $('row-odd-x').value = t.oddX;

        transforms = [];
        t.transforms.map(normalizeTransform).forEach((tr) => {
            const def = TYPES[tr.type];
            const values = {};
            [...def.fields, ...def.steps].forEach((f) => { values[f.key] = f.def; });
            transforms.push({ type: tr.type, values: Object.assign(values, tr.values) });
        });
        renderList();

        view.zoom = 1; view.x = 0; view.y = 0;
        generate(t.name);
    }

    function itemBounds(sc, item) {
        const m = item.matrix;
        const own = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        if (!Number.isFinite(own) || own < 1e-3 || own > 1e4) return null;

        const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        const { size, sx, sy } = sc;
        const shape = item.shape || 'square';
        const h = size / 2;

        if (shape === 'circle') {
            const [cx, cy] = at(sx, sy);
            const r = h * own;
            return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r };
        }
        let corners;
        if (shape === 'square') {
            corners = [[sx - h, sy - h], [sx + h, sy - h], [sx + h, sy + h], [sx - h, sy + h]];
        } else if (shape === 'rectangle') {
            const hw = sc.width / 2, hh = sc.height / 2;
            corners = [[sx - hw, sy - hh], [sx + hw, sy - hh], [sx + hw, sy + hh], [sx - hw, sy + hh]];
        } else if (shape === 'oval') {
            const t = rad(sc.tilt), co = Math.cos(t), si = Math.sin(t);
            corners = [];
            for (let k = 0; k < 48; k++) {
                const a = (k / 48) * Math.PI * 2;
                const ex = (sc.width / 2) * Math.cos(a), ey = (sc.height / 2) * Math.sin(a);
                corners.push([sx + ex * co - ey * si, sy + ex * si + ey * co]);
            }
        } else if (shape === 'hexagon' || shape === 'pentagon') {
            corners = polygonCorners(sx, sy, size, shape === 'pentagon' ? 5 : 6);
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

    function saveImage() {
        if (!scene) {
            statusEl.textContent = 'There is nothing to save yet.';
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
            statusEl.textContent = 'There is nothing visible to save.';
            return;
        }

        const PAD = 24;
        const MAX_SIDE = 2000;
        const w = maxX - minX;
        const h = maxY - minY;
        const s = Math.min(4, (MAX_SIDE - 2 * PAD) / Math.max(w, h, 1e-6));

        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.ceil(w * s + 2 * PAD));
        out.height = Math.max(1, Math.ceil(h * s + 2 * PAD));
        const c = out.getContext('2d');

        if (!$('transparent-bg').checked) {
            c.fillStyle = $('save-bg-color').value;
            c.fillRect(0, 0, out.width, out.height);
        }

        const base = [s, 0, 0, -s, PAD - s * minX, PAD + s * maxY];
        scene.items.forEach((item) => drawShape(scene, item, c, base));

        out.toBlob((blob) => {
            if (!blob) {
                statusEl.textContent = 'The image could not be created.';
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
            statusEl.textContent = `Saved pattern.png (${out.width} by ${out.height} px).`;
        }, 'image/png');
    }

    const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

    function zoomAt(cx, cy, factor) {
        const z = clampZoom(view.zoom * factor);
        const f = z / view.zoom;
        view.x = (cx - W / 2) - ((cx - W / 2) - view.x) * f;
        view.y = (cy - H / 2) - ((cy - H / 2) - view.y) * f;
        view.zoom = z;
        requestRedraw();
    }

    function toCanvas(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
    }

    const pointers = new Map();
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
        e.preventDefault();
        const p = toCanvas(e.clientX, e.clientY);
        zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    $('zoom-in-btn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.25));
    $('zoom-out-btn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.25));
    $('reset-view-btn').addEventListener('click', () => {
        view.zoom = 1; view.x = 0; view.y = 0;
        requestRedraw();
    });

    $('add-transform').addEventListener('click', () => addTransform($('transform-select').value));
    $('save-image-btn').addEventListener('click', saveImage);
    $('generate-btn').addEventListener('click', () => generate());

    const STORE_KEY = 'patternGenerator.userTemplates';
    const SHAPES_LIST_ALL = ['circle', 'oval', 'triangle', 'square', 'rectangle', 'pentagon', 'hexagon'];

    const templateToggle = $('template-toggle');
    const templateBody = $('template-body');
    const defaultList = $('template-list-default');
    const userList = $('template-list-user');
    const userEmpty = $('template-empty');
    const noteEl = $('template-note');
    const nameInput = $('template-name');
    const applyBtn = $('apply-template-btn');
    let selectedTemplate = null;

    const isValidTemplate = (t) =>
        t && typeof t.id === 'string' && typeof t.name === 'string' &&
        Array.isArray(t.transforms) &&
        t.transforms.every((tr) => tr && TYPES[tr.type] && tr.values && typeof tr.values === 'object');

    function loadUserTemplates() {
        try {
            const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
            return Array.isArray(data)
                ? data.filter(isValidTemplate).map((t) => Object.assign({}, t, { colors: normalizeColors(t) }))
                : [];
        } catch (err) {
            return [];
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

    function readSettings() {
        const n = (id, fallback) => {
            const v = parseFloat($(id).value);
            return Number.isFinite(v) ? v : fallback;
        };
        return {
            shapes: getShapeList(),
            shapeMode: $('shape-mode').value,
            size: n('shape-size', 60),
            width: n('shape-width', 90),
            height: n('shape-height', 50),
            corner: n('shape-corner', 0),
            tilt: n('shape-tilt', 0),
            border: $('show-border').checked,
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
        applyBtn.disabled = !id;
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
            pick.addEventListener('click', () => selectTemplate(t.id));
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
        applyBtn.disabled = false;
        say(stored
            ? `Saved "${name}".`
            : `Saved "${name}" for this session only, because the browser blocked storage.`);
    }

    function deleteTemplate(id) {
        const t = userTemplates.find((x) => x.id === id);
        userTemplates = userTemplates.filter((x) => x.id !== id);
        storeUserTemplates();
        if (selectedTemplate === id) selectedTemplate = null;
        renderTemplates();
        applyBtn.disabled = !selectedTemplate;
        say(t ? `Deleted "${t.name}".` : '');
    }

    templateToggle.addEventListener('click', () => {
        const open = templateToggle.getAttribute('aria-expanded') !== 'true';
        templateToggle.setAttribute('aria-expanded', String(open));
        templateBody.hidden = !open;
        $('template-arrow').textContent = open ? '-' : '+';
    });

    applyBtn.addEventListener('click', () => {
        if (!selectedTemplate) return;
        applyTemplate(selectedTemplate);
        const t = findTemplate(selectedTemplate);
        if (t) say(`Applied "${t.name}".`);
    });

    $('save-template-btn').addEventListener('click', saveTemplate);
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveTemplate();
    });

    userTemplates = loadUserTemplates();
    renderTemplates();

    const PANELS = {
        options:   { el: document.querySelector('.generator-controls'), label: 'options' },
        templates: { el: document.querySelector('.template-panel'),     label: 'templates' },
        zoom:      { el: document.querySelector('.canvas-controls'),    label: 'zoom' }
    };

    document.querySelectorAll('.toolbar-btn[data-panel]').forEach((btn) => {
        const panel = PANELS[btn.dataset.panel];
        btn.addEventListener('click', () => {
            const show = panel.el.hidden;
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
            text: 'this is a demonstration of math as a science of patterns. start with shapes, mix them together, apply transformations, and repeat them to build patterns.',
            tip: 'you can mix multiple shapes together and control the exact pattern through which they pop up.'
        },
        {
            title: '1. mix shapes & pick patterns',
            text: 'add multiple shapes to your shape list (circles, ovals, triangles, squares, rectangles, pentagons, hexagons) and use the "shape by" menu to control how they cycle or pop up across rows, columns, diagonals, or random picks. set their size, start position, and specific dimensions for ovals or rectangles.',
            tip: 'turn on the direction dot to see how shapes flip or turn.'
        },
        {
            title: '2. add transformations',
            text: 'translation slides a shape, reflection mirrors it across an axis line, rotation turns it around a center point, and dilation scales it. note that reflection mirrors across an axis line, whereas rotation turns around a center point. run them from top to bottom, each one building on the last.',
            tip: 'use the arrows on each card to change the order of transformations.'
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
            text: 'start with two colors and add more if you like, or pick a color template. gradients blend through your colors in order, and repeating patterns cycle through them.',
            tip: 'with three or more colors, try row stripes or diagonal stripes.'
        },
        {
            title: 'generate, explore and save',
            text: 'your changes wait until you press generate at the bottom of the options. drag the canvas to move around, and scroll or pinch to zoom. save image downloads the whole pattern as a PNG.',
            tip: 'every options panel has its own reset button.'
        },
        {
            title: 'templates and toolbar',
            text: 'open templates on the canvas, pick one and press apply to load a ready-made pattern, or save your own settings to use again later.',
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
        try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch (err) {}
        if (focusBeforeTutorial && focusBeforeTutorial.focus) focusBeforeTutorial.focus();
    }

    tutorialBack.addEventListener('click', () => showTutorialStep(tutorialStep - 1));
    tutorialNext.addEventListener('click', () => {
        if (tutorialStep === TUTORIAL_STEPS.length - 1) closeTutorial();
        else showTutorialStep(tutorialStep + 1);
    });
    $('tutorial-close').addEventListener('click', closeTutorial);
    $('tutorial-btn').addEventListener('click', openTutorial);

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

    const RESET_FIELDS = {
        grid: ['repeat-count', 'row-count', 'row-x', 'row-y', 'row-odd-x'],
        output: ['save-bg-color', 'transparent-bg']
    };

    const initialFields = {};
    Object.values(RESET_FIELDS).flat().forEach((id) => {
        const el = $(id);
        initialFields[id] = el.type === 'checkbox' ? el.checked : el.value;
    });

    function updateShapeFields() {
        const shapes = getShapeList();
        document.querySelectorAll('.generator-controls [data-shapes]').forEach((el) => {
            const targetShapes = el.dataset.shapes.split(' ');
            const matches = shapes.some((s) => targetShapes.includes(s));
            el.hidden = !matches;
        });
    }

    function updateSaveBgState() {
        $('save-bg-color').disabled = $('transparent-bg').checked;
    }
    $('transparent-bg').addEventListener('change', updateSaveBgState);

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
        applyPaletteBtn.disabled = true;
        paletteNote.textContent = '';
    }

    function resetShapes() {
        setShapeList(DEFAULT_SHAPES);
        setShapeMode('seq');
        $('shape-size').value = 60;
        $('shape-width').value = 90;
        $('shape-height').value = 50;
        $('shape-corner').value = 0;
        $('shape-tilt').value = 0;
        $('shape-x').value = -250;
        $('shape-y').value = 0;
        $('show-border').checked = true;
        $('show-marker').checked = false;
        $('show-axes').checked = true;
        updateShapeFields();
    }

    const PANEL_RESETS = {
        shape: () => {
            resetShapes();
            return 'Shape options reset.';
        },
        transformations: () => {
            resetTransforms();
            return 'Transformations cleared.';
        },
        grid: () => {
            restoreFields(RESET_FIELDS.grid);
            return 'Repeat and grid options reset.';
        },
        colors: () => {
            resetColors();
            return 'Colors reset.';
        },
        output: () => {
            restoreFields(RESET_FIELDS.output);
            updateSaveBgState();
            return 'Saving options reset.';
        }
    };

    document.querySelectorAll('.panel-reset').forEach((btn) => {
        btn.addEventListener('click', () => {
            const message = PANEL_RESETS[btn.dataset.reset]();
            if (btn.dataset.reset === 'output') {
                statusEl.textContent = message;
                return;
            }
            changed();
            statusEl.textContent = `${message} Press generate to redraw.`;
        });
    });

    const controlsEl = document.querySelector('.generator-controls');
    ['input', 'change'].forEach((type) => {
        controlsEl.addEventListener(type, (e) => {
            const el = e.target;
            if (el.id === 'palette-select' || el.id === 'transform-select' || el.id === 'shape-mode') return;
            if (el.id === 'save-bg-color' || el.id === 'transparent-bg') return;
            if (el.type === 'color') {
                paletteSelect.value = '';
                applyPaletteBtn.disabled = true;
                paletteNote.textContent = '';
            }
            changed();
        });
    });

    function resetAll() {
        restoreFields(Object.values(RESET_FIELDS).flat());
        updateSaveBgState();
        resetShapes();
        resetTransforms();
        resetColors();
        selectTemplate(null);
        view.zoom = 1; view.x = 0; view.y = 0;
        scene = null;
        redraw();
        setDirty(false);
        statusEl.textContent = 'All options have been reset. The canvas is blank.';
    }

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
            statusEl.textContent = 'Press reset all again to confirm.';
            resetAllTimer = setTimeout(disarmResetAll, 3000);
            return;
        }
        disarmResetAll();
        resetAll();
    });

    setShapeList(DEFAULT_SHAPES);
    setShapeMode('seq');
    shapeModeSelect.addEventListener('change', updateShapeModeHint);
    $('add-shape-btn').addEventListener('click', () => {
        const n = shapeListEl.children.length;
        if (n < MAX_SHAPES_COUNT) {
            const used = new Set(getShapeList());
            const nextShape = SHAPE_OPTIONS.find(([val]) => !used.has(val))?.[0] || 'circle';
            addShapeRow(nextShape);
        }
        updateShapeButtons();
        updateShapeFields();
        changed();
    });
    $('remove-shape-btn').addEventListener('click', () => {
        if (shapeListEl.children.length > MIN_SHAPES_COUNT) shapeListEl.lastElementChild.remove();
        updateShapeButtons();
        updateShapeFields();
        changed();
    });

    setPalette(DEFAULT_COLORS.slice(0, MIN_COLORS));
    setColorMode('seq');
    modeSelect.addEventListener('change', updateModeHint);
    $('add-color-btn').addEventListener('click', () => {
        const n = colorList.children.length;
        if (n < MAX_COLORS) {
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
    updateShapeFields();
    redraw();

    let tutorialSeen = false;
    try { tutorialSeen = localStorage.getItem(TUTORIAL_KEY) === '1'; } catch (err) {}
    if (!tutorialSeen) openTutorial();
})();