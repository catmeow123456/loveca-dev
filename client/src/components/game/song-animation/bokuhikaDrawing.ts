/** Presentation only. Coordinates describe a small flower stage, never game objects. */
export const BOKUHIKA_FLOWER_DURATION = 2800;
export const progress = (time: number, start: number, duration: number) =>
  Math.max(0, Math.min(1, (time - start) / duration));
export const smooth = (n: number) => n * n * (3 - 2 * n);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type Vec = [number, number, number];
const normalize = (v: Vec): Vec => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l) as Vec;
};
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const subtract = (a: Vec, b: Vec): Vec => a.map((n, i) => n - b[i]) as Vec;

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform float uScale;
uniform mediump float uMode;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
void main() {
  float depth = aPosition.y * .48 + aPosition.z * .877;
  vec2 p = vec2(aPosition.x, aPosition.y * .877 - aPosition.z * .48);
  // The flower stays in perspective; the readable card faces the viewer.
  if (uMode > 1.5) {
    depth = aPosition.z * .877;
    p = vec2(aPosition.x, aPosition.y - aPosition.z * .48);
  }
  float perspective = 950. / (950. - depth);
  p = uCenter + p * uScale * perspective;
  // Emerge from the bud, then keep the entire card legible above the open petals.
  float layerDepth = depth;
  if (uMode > 1.5) layerDepth += smoothstep(24., 58., aPosition.z) * 260.;
  gl_Position = vec4(p.x / uViewport.x * 2. - 1., 1. - p.y / uViewport.y * 2., -layerDepth / 700., 1.);
  vNormal = aNormal;
  vPosition = aPosition;
  vUv = aUv;
}`;
const FRAGMENT = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
uniform mediump float uMode;
uniform float uAlpha;
uniform float uGather;
uniform sampler2D uCard;
void main() {
  if (uMode > 1.5) {
    gl_FragColor = texture2D(uCard, vUv) * vec4(1.,1.,1.,uAlpha);
    return;
  }
  vec3 normal = normalize(vNormal);
  vec3 light = normalize(vec3(-.38,-.45,1.));
  float diffuse = abs(dot(normal, light));
  float silk = pow(abs(dot(normal, normalize(vec3(-.22,-.3,1.)))), 18.);
  float edge = pow(abs(vUv.y * 2. - 1.), 4.);
  float tip = smoothstep(.68, 1., vUv.x);
  vec3 ivory = vec3(1., .92, .88);
  vec3 rose = vec3(.87, .38, .55);
  vec3 color = mix(ivory, rose, .14 + edge * .47 + tip * .23);
  if (uMode > .5) color = mix(color, vec3(.96,.69,.76), .35);
  float vein = pow(.5 + .5*cos((vUv.y-.5)*64. + sin(vUv.x*5.)*.8), 12.);
  float grain = fract(sin(dot(vUv, vec2(127.1,311.7))) * 43758.5453);
  color *= .59 + diffuse * .4;
  color += silk * .12 + vein * .026 * sin(vUv.x*3.14159) + grain*.009;
  color += uGather * exp(-vUv.x*4.) * vec3(.18,.12,.06);
  gl_FragColor = vec4(color, uAlpha);
}`;

function shader(gl: WebGLRenderingContext, type: number, text: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, text);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(error || 'Flower shader failed');
  }
  return s;
}

/** Curved petal: the root stays attached while the rib bows and the tip unfurls. */
function petalPoint(u: number, v: number, angle: number, opened: number, inner: boolean): Vec {
  const length = inner ? 190 : 246;
  const width = (inner ? 62 : 79) * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.78);
  const closedRadius = 49 + Math.sin(Math.PI * u) * 54 - u * 46;
  const openRadius = 49 + length * u;
  const radius = mix(closedRadius, openRadius, opened);
  const zClosed = 16 + (inner ? 195 : 220) * u;
  const zOpen = 16 - Math.sin(Math.PI * u) * 14 + 48 * Math.pow(u, 3);
  const cupping = width * 0.27 * v * v + Math.sin(Math.PI * u) * 4 * Math.cos(v * Math.PI);
  const z = mix(zClosed, zOpen, opened) + cupping + (inner ? 23 * opened : 0);
  const side = width * v;
  const twist = angle + Math.sin(Math.PI * u) * 0.065 * opened;
  return [
    Math.cos(twist) * radius - Math.sin(twist) * side,
    Math.sin(twist) * radius + Math.cos(twist) * side,
    z,
  ];
}

export function createBokuhikaRenderer(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  if (!gl) return null;
  const vs = shader(gl, gl.VERTEX_SHADER, VERTEX),
    fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Flower program failed');
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, size, offset] of [
    ['aPosition', 3, 0],
    ['aNormal', 3, 12],
    ['aUv', 2, 24],
  ] as const) {
    const a = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, size, gl.FLOAT, false, 32, offset);
  }
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    viewport: uniform('uViewport'),
    center: uniform('uCenter'),
    scale: uniform('uScale'),
    alpha: uniform('uAlpha'),
    mode: uniform('uMode'),
    gather: uniform('uGather'),
  };
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const rows = 22,
    columns = 12;
  const vertices = new Float32Array(18 * rows * columns * 6 * 8);
  const card = new Float32Array(6 * 8);
  const quad = [
    [-1, -1, 0, 0],
    [1, -1, 1, 0],
    [1, 1, 1, 1],
    [-1, -1, 0, 0],
    [1, 1, 1, 1],
    [-1, 1, 0, 1],
  ];
  let disposed = false;
  return {
    draw(
      time: number,
      width: number,
      height: number,
      center: readonly [number, number],
      scale: number
    ) {
      if (disposed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform2f(uniforms.viewport, width, height);
      gl.uniform2f(uniforms.center, ...center);
      gl.uniform1f(uniforms.scale, scale);
      const alpha = smooth(progress(time, 150, 230)) * (1 - smooth(progress(time, 2380, 420)));
      gl.uniform1f(uniforms.alpha, alpha);
      gl.uniform1f(uniforms.gather, smooth(progress(time, 1580, 620)));
      let cursor = 0;
      for (let layer = 0; layer < 2; layer++)
        for (let i = 0; i < 9; i++) {
          const inner = layer === 1,
            angle = (i * Math.PI * 2) / 9 - Math.PI / 2 + (layer * Math.PI) / 9;
          const t = progress(time, 410 + layer * 170 + i * 23, 1000);
          const opened = smooth(t) + Math.sin(Math.PI * t * 2) * 0.027 * Math.sin(Math.PI * t);
          const vertex = (u: number, v: number) => {
            const p = petalPoint(u, v, angle, opened, inner);
            const du = subtract(
              petalPoint(Math.min(0.9999, u + 0.001), v, angle, opened, inner),
              petalPoint(Math.max(0.0001, u - 0.001), v, angle, opened, inner)
            );
            const dv = subtract(
              petalPoint(u, v + 0.001, angle, opened, inner),
              petalPoint(u, v - 0.001, angle, opened, inner)
            );
            const n = normalize(cross(du, dv));
            vertices.set([...p, ...n, u, (v + 1) / 2], cursor);
            cursor += 8;
          };
          for (let row = 0; row < rows; row++)
            for (let col = 0; col < columns; col++) {
              const u = row / rows,
                u1 = (row + 1) / rows,
                v = (col / columns) * 2 - 1,
                v1 = ((col + 1) / columns) * 2 - 1;
              vertex(u, v);
              vertex(u1, v);
              vertex(u1, v1);
              vertex(u, v);
              vertex(u1, v1);
              vertex(u, v1);
            }
        }
      gl.uniform1f(uniforms.mode, 0);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, cursor / 8);
      const cardReveal = smooth(progress(time, 650, 550));
      const halfWidth = mix(73, 120, cardReveal) * 1.2,
        halfHeight = (halfWidth * image.height) / image.width;
      quad.forEach(([x, y, u, v], i) =>
        card.set([x * halfWidth, y * halfHeight, 24 + cardReveal * 34, 0, 0, 1, u, v], i * 8)
      );
      gl.uniform1f(uniforms.mode, 2);
      gl.bufferData(gl.ARRAY_BUFFER, card, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      disposed = true;
      gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
