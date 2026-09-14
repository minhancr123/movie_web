'use client';

import { useEffect, useRef } from 'react';
import { readShaderEnabled, onShaderEnabledChange } from '@/lib/shaderPref';

interface SpatialShaderProps {
  className?: string;
  /** Master opacity of the canvas (Stitch uses 0.85 hero / 0.4 player bg). */
  opacity?: number;
  /** Time multiplier for the animation. */
  speed?: number;
  /** Track the cursor and feed it to u_mouse. */
  interactive?: boolean;
}

const VERTEX_SHADER = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

// Ported from Stitch "Dynamic Spatial Hologram Background Shader"
// (ANIMATION_11): simplex-noise iridescent cinema light field in the
// CineStream palette — deep space, amber gold, electric violet, laser cyan.
const FRAGMENT_SHADER = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,
                      0.366025403784439,
                     -0.577350269189626,
                      0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1  = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    st.y = 1.0 - st.y;

    float t = u_time * 0.25;

    // Spatial iridescent cinema light field
    float n1 = snoise(st * 2.2 + vec2(t * 0.4, -t * 0.3));
    float n2 = snoise(st * 3.5 - vec2(-t * 0.2, t * 0.35) + n1 * 0.5);
    float n3 = snoise(st * 1.5 + vec2(t * 0.1, t * 0.15));

    // Core Cinema Palettes: Deep Space -> Amber Gold -> Electric Violet -> Cyan Laser
    vec3 deepSpace = vec3(0.04, 0.045, 0.07);
    vec3 amberGold = vec3(0.96, 0.62, 0.05);
    vec3 electricViolet = vec3(0.48, 0.18, 0.93);
    vec3 laserCyan = vec3(0.02, 0.71, 0.83);

    float auroraWeight1 = smoothstep(-0.2, 0.8, n1 + st.y * 0.5);
    float auroraWeight2 = smoothstep(-0.1, 0.9, n2 - st.x * 0.3);

    vec3 col = deepSpace;
    col = mix(col, electricViolet * 0.7, auroraWeight1 * 0.45);
    col = mix(col, amberGold * 0.8, pow(auroraWeight2, 2.2) * 0.5);
    col += laserCyan * pow(clamp(n3 * 0.6 + 0.4, 0.0, 1.0), 3.0) * 0.25;

    // Soft top-down vignette for readability
    float vignette = smoothstep(1.3, 0.2, length(st - vec2(0.5, 0.4)));
    col *= (0.7 + 0.3 * vignette);

    // Subtle star dust shimmer
    float dust = fract(sin(dot(st.xy ,vec2(12.9898,78.233))) * 43758.5453);
    if (dust > 0.992) {
        col += vec3(1.0, 0.95, 0.8) * 0.35 * (0.5 + 0.5 * sin(u_time * 3.0 + dust * 100.0));
    }

    gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Realtime WebGL cinematic shader background, ported 1:1 from the Stitch
 * visionOS spatial screen. Renders a slow simplex-noise aurora in the
 * CineStream palette with star-dust shimmer. Zero dependencies, pauses when
 * the tab is hidden, releases the GL context on unmount. If WebGL is
 * unavailable the canvas stays transparent (CSS gradients behind still show).
 */
export default function SpatialShader({
  className = '',
  opacity = 0.85,
  speed = 1,
  interactive = true,
}: SpatialShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * Read through a ref rather than a dependency: rebuilding the effect would
   * recreate the GL context, and the note below explains why this canvas must
   * keep the one it has.
   */
  const enabledRef = useRef(true);
  const restartRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const syncSize = () => {
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    syncSize();

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', syncSize);

    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      canvas.dataset.shader = 'no-webgl';
      return () => {
        ro?.disconnect();
        window.removeEventListener('resize', syncSize);
      };
    }

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('WebGL shader alloc failed');
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };

    let raf = 0;
    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    try {
      const prog = gl.createProgram();
      if (!prog) throw new Error('WebGL program alloc failed');
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog)}`);
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const pos = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

      const uTime = gl.getUniformLocation(prog, 'u_time');
      const uRes = gl.getUniformLocation(prog, 'u_resolution');
      const uMouse = gl.getUniformLocation(prog, 'u_mouse');

      const onMouseMove = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse = { x: nx * canvas.width, y: ny * canvas.height };
      };
      if (interactive) window.addEventListener('mousemove', onMouseMove);

      // NOTE: do NOT call loseContext() in cleanup. React 18 StrictMode
      // (dev) mounts -> cleans up -> remounts, and a canvas keeps a single
      // GL context object: killing it in cleanup leaves the remount with a
      // lost context, so the shader silently never draws.
      let firstFrame = true;
      const render = (t: number) => {
        // Switched off: stop drawing entirely rather than drawing something
        // invisible. This is the whole point of the switch — on a machine
        // without GPU acceleration a full-screen noise shader is the most
        // expensive thing on the page, and hiding it would save nothing.
        if (!enabledRef.current) {
          raf = 0;
          gl.clear(gl.COLOR_BUFFER_BIT);
          return;
        }
        if (typeof ResizeObserver === 'undefined') syncSize();
        gl.viewport(0, 0, canvas.width, canvas.height);
        if (uTime) gl.uniform1f(uTime, (t * 0.001 * speed) % 3600);
        if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
        if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (firstFrame) {
          firstFrame = false;
          canvas.dataset.shader = 'running';
          console.info('[SpatialShader] running');
        }
        raf = requestAnimationFrame(render);
      };
      restartRef.current = () => {
        if (!raf) raf = requestAnimationFrame(render);
      };
      enabledRef.current = readShaderEnabled();
      if (enabledRef.current) raf = requestAnimationFrame(render);

      return () => {
        restartRef.current = null;
        cancelAnimationFrame(raf);
        if (interactive) window.removeEventListener('mousemove', onMouseMove);
        ro?.disconnect();
        window.removeEventListener('resize', syncSize);
      };
    } catch (err) {
      canvas.dataset.shader = 'error';
      console.warn('[SpatialShader] WebGL unavailable, skipping:', err);
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', syncSize);
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => onShaderEnabledChange((on) => {
    enabledRef.current = on;
    if (on) restartRef.current?.();
  }), []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block h-full w-full ${className}`}
      style={{ opacity }}
    />
  );
}
