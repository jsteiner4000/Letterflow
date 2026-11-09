// Glas der Pille: Linsenberechnung (WebGL, Maße aus docs/design/pille-v3.html) und Glas-Einstellungen.
// Gemeinsam für das Aufnahme-Fenster (erfasster Bildschirmstreifen) und die Vorschau in den
// Einstellungen (festes Beispielbild). Bilder liegen nur im Speicher.
window.PilleGlas = (() => {
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = `precision highp float;
uniform sampler2D tex; uniform vec2 texSize; uniform vec2 size; uniform vec2 off;
uniform float S; uniform float ts; uniform float refr; uniform float bgra;
void main(){
  vec2 f = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  float r = size.y * .5; vec2 c = size * .5; float rim = 16. * S;
  vec2 d = f - c;
  float qx = max(abs(d.x) - (c.x - r), 0.), qy = abs(d.y);
  float q = length(vec2(qx, qy));
  float t = clamp(1. - (r - q) / rim, 0., 1.);
  vec2 n = q > 1e-3 ? vec2(qx * sign(d.x), d.y) / q : vec2(0.);
  float k = refr / .6;
  float bend = pow(t, 2.2) * rim * 1.8 * k;
  float mag = 1. / (1. + .07 * k);
  vec3 o = vec3(0.);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float kc = 1. + (fi - 1.) * .06 * k;
    vec2 pos = off + (c + d * mag + n * bend * kc) * ts;
    vec3 s = texture2D(tex, (pos + .5) / texSize).rgb;
    if (bgra > .5) s = s.bgr;
    if (i == 0) o.r = s.r; else if (i == 1) o.g = s.g; else o.b = s.b;
  }
  // Kante weich über ~1 Bildpunkt (vormultipliertes Alpha); die Form schneidet CSS (border-radius).
  float a = clamp(r - q + .5, 0., 1.);
  gl_FragColor = vec4(o * a, a);
}`;

  // Gerätepixel je CSS-Pixel als --dpr (scharfe 1-Bildpunkt-Linien); neu bei Bildschirmwechsel.
  (function dprMerken() {
    document.documentElement.style.setProperty('--dpr', String(devicePixelRatio));
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', dprMerken, {
      once: true,
    });
  })();

  // null, wenn WebGL fehlt: die Pille bleibt dann beim getönten Glas.
  function erzeugen(canvas) {
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
    });
    if (!gl) return null;
    const bauen = (typ, quelle) => {
      const s = gl.createShader(typ);
      gl.shaderSource(s, quelle);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, bauen(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, bauen(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ort = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(ort);
    gl.vertexAttribPointer(ort, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    const u = (n) => gl.getUniformLocation(prog, n);
    let tex = { w: 1, h: 1, bgra: 0 };
    // Zeichenfläche = CSS-Größe × devicePixelRatio, exakt aus dem Layout (auch nach Bildschirmwechsel).
    let px = null;
    let zuletzt = null;
    new ResizeObserver(([e]) => {
      const b = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
      px = b ? [b.inlineSize, b.blockSize] : null;
      if (zuletzt) zeichnen(zuletzt);
    }).observe(canvas, { box: 'device-pixel-content-box' });
    // Ursprung (ox, oy) im Bild (Pixel), s: Bildpixel je CSS-Pixel.
    function zeichnen(a) {
      zuletzt = a;
      const dpr = devicePixelRatio;
      const [w, h] =
        px || [canvas.clientWidth, canvas.clientHeight].map((v) => Math.round(v * dpr));
      if (!w || !h) return;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u('texSize'), tex.w, tex.h);
      gl.uniform2f(u('size'), w, h);
      gl.uniform2f(u('off'), a.ox, a.oy);
      gl.uniform1f(u('S'), h / 52); // Linsenmaße in CSS-Pixeln der 52 px hohen Pille
      gl.uniform1f(u('ts'), a.s / (h / 52));
      gl.uniform1f(u('refr'), a.refraction / 100);
      gl.uniform1f(u('bgra'), tex.bgra);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    return {
      // Bild: Canvas (rgba) oder { daten: Uint8Array BGRA, w, h }
      bild(quelle) {
        if (quelle.daten) {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            quelle.w,
            quelle.h,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            quelle.daten,
          );
          tex = { w: quelle.w, h: quelle.h, bgra: 1 };
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, quelle);
          tex = { w: quelle.width, h: quelle.height, bgra: 0 };
        }
      },
      zeichnen,
    };
  }

  // Mittlere Helligkeit (0–1) eines Rechtecks (Pixel) in RGBA- oder BGRA-Daten.
  function helligkeit(daten, breite, x, y, w, h, bgra) {
    let summe = 0;
    let n = 0;
    const [ri, bi] = bgra ? [2, 0] : [0, 2];
    for (let j = y; j < y + h; j += 4)
      for (let i = x; i < x + w; i += 4) {
        const o = 4 * (j * breite + i);
        summe += 0.2126 * daten[o + ri] + 0.7152 * daten[o + 1] + 0.0722 * daten[o + bi];
        n++;
      }
    return n ? summe / n / 255 : 0.5;
  }

  const TOENE = {
    hell: [255, 255, 255],
    neutral: [200, 202, 208],
    dunkel: [22, 24, 28],
    warm: [255, 214, 170],
    petrol: [15, 118, 110],
  };
  const farbe = (t) =>
    TOENE[t] || [1, 3, 5].map((i) => parseInt(String(t).slice(i, i + 2), 16)) || TOENE.hell;
  const leucht = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Setzt Variablen und Klassen der Pille. lum: Helligkeit des erfassten Bereichs, null = unbekannt.
  function anwenden(pille, cfg, lum) {
    const f = cfg.frost / 100;
    const o = cfg.opacity / 100;
    const ton = farbe(cfg.tint);
    const deck = Math.pow(1 - o, 1.5);
    const hell0 = lum !== null && lum > 0.6;
    const st = pille.style;
    st.setProperty('--t', ton.join(','));
    st.setProperty('--blur', `${(f * 3).toFixed(2)}px`);
    st.setProperty('--milch-a', ((hell0 ? 0.85 : 0.65) * f).toFixed(3));
    st.setProperty('--milch-b', ((hell0 ? 0.5 : 0.35) * f).toFixed(3));
    st.setProperty('--deck', deck.toFixed(3));
    // Dunkle Balken nur über hellem Grund: Helligkeit des erfassten Bereichs (roh), bei starker
    // Deckkraft zur Tönung hin gemischt (sonst weiße Balken auf weißem Deckglas).
    const lt = leucht(ton);
    const lc = lum === null ? lt : lum * (1 - deck) + lt * deck;
    // Über hellem Grund das Glas abdunkeln (Ebene in .milch, Übergang per CSS), Stärke 0–100 %.
    const dunkel =
      cfg.autoDarken !== false && lum !== null
        ? ((cfg.autoDarkenStrength ?? 50) / 100) *
          0.6 *
          Math.min(1, Math.max(0, (lum - 0.6) / 0.25))
        : 0;
    st.setProperty('--dunkel', dunkel.toFixed(3));
    pille.classList.toggle('hellgrund', lc * (1 - dunkel) + 0.08 * dunkel > 0.6);
  }

  return { erzeugen, helligkeit, anwenden };
})();
