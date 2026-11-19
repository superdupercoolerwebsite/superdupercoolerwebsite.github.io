// Final screen pass: ink outlines (3 styles) + film-like tone mapping.
import * as THREE from 'three';

export const OUTLINE_NAMES = ['Off', 'Thin and subtle', 'Bold comic', 'Car and objects only'];

export class Post {
  constructor(renderer, camera) {
    this.renderer = renderer; this.camera = camera;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, s.x), Math.max(2, s.y), { type: THREE.HalfFloatType, samples: 4 });
    this.rt.depthTexture = new THREE.DepthTexture(Math.max(2, s.x), Math.max(2, s.y));
    this.uniforms = {
      tC: { value: this.rt.texture }, tD: { value: this.rt.depthTexture },
      uPx: { value: new THREE.Vector2(1 / s.x, 1 / s.y) },
      uNear: { value: camera.near }, uFar: { value: camera.far },
      uTan: { value: new THREE.Vector2() },
      uMode: { value: 1 }, uScale: { value: 1 }, uExposure: { value: 1 },
      uBlur: { value: 0 }, uTime: { value: 0 }, uHeat: { value: 0 },
    };
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tC, tD; uniform vec2 uPx, uTan; uniform float uNear, uFar, uScale, uExposure, uBlur, uTime, uHeat; uniform int uMode;
        varying vec2 vUv;
        float iz(vec2 uv){ return (uFar - texture2D(tD, uv).x * (uFar - uNear)) / (uNear * uFar); }
        vec3 vp(vec2 uv, float i){ float z = 1.0 / i; return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          // heat shimmer: sand a long way off wobbles in the hot air near the ground
          float far_ = 1.0 / iz(vUv);
          float shim = uHeat * smoothstep(70.0, 500.0, far_) * (1.0 - step(uFar * 0.8, far_));
          vec2 uvS = vUv + vec2(sin(vUv.y * 260.0 + uTime * 6.5), sin(vUv.x * 170.0 + uTime * 5.1)) * vec2(0.0010, 0.0007) * shim;
          vec4 c = texture2D(tC, uvS);
          vec3 col = c.rgb;
          // speed: the edges of the picture streak toward the corners, the middle stays sharp
          if (uBlur > 0.001) {
            vec2 dir = vUv - 0.5; float amt = uBlur * dot(dir, dir) * 0.16;
            for (int i = 1; i < 6; i++) col += texture2D(tC, uvS - dir * amt * float(i)).rgb;
            col /= 6.0;
          }
          if (uMode > 0) {
            float thick = (uMode == 1 ? 1.0 : (uMode == 2 ? 2.4 : 1.6)) * uScale;
            vec2 o = uPx * thick;
            vec2 ul = vUv - vec2(o.x, 0.0), ur = vUv + vec2(o.x, 0.0), uu = vUv + vec2(0.0, o.y), ud = vUv - vec2(0.0, o.y);
            float zc = iz(vUv), zl = iz(ul), zr = iz(ur), zu = iz(uu), zd = iz(ud);
            float near_ = 1.0 / max(max(zc, zl), max(max(zr, zu), zd));     // closest of the five
            float sil = max(abs(zl + zr - 2.0 * zc), abs(zu + zd - 2.0 * zc)) / zc;
            vec3 P = vp(vUv, zc);
            vec3 n1 = normalize(cross(vp(ur, zr) - P, vp(uu, zu) - P));
            vec3 n2 = normalize(cross(P - vp(ul, zl), P - vp(ud, zd)));
            float crease = smoothstep(0.10, 0.30, 1.0 - dot(n1, n2));
            float eSil = smoothstep(0.03, 0.09, sil);
            float ml = texture2D(tC, ul).a, mr = texture2D(tC, ur).a, mu = texture2D(tC, uu).a, md = texture2D(tC, ud).a;
            float mmax = max(max(c.a, ml), max(max(mr, mu), md)), mmin = min(min(c.a, ml), min(min(mr, mu), md));
            // objects: their outer edge, plus folds and overlaps inside them
            float eObj = max(smoothstep(0.15, 0.6, mmax - mmin), step(0.5, mmin) * max(eSil, crease));
            // sand: dune silhouettes, and (bold only) the crest creases
            float sand = 1.0 - step(0.01, mmax);
            float eSand = 0.0;
            if (uMode == 1) eSand = eSil * 0.38 * (1.0 - smoothstep(80.0, 600.0, near_));
            if (uMode == 2) eSand = max(eSil * (1.0 - smoothstep(400.0, 2000.0, near_)),
                                        crease * 0.85 * (1.0 - smoothstep(200.0, 800.0, near_)));
            float e = max(eObj, eSand * sand);
            col = mix(col, vec3(0.022, 0.014, 0.010), e);
          }
          col = aces(col * uExposure);
          gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
        }`,
    });
    const tri = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    tri.frustumCulled = false;
    this.scene.add(tri);
  }

  resize() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (s.x < 2 || s.y < 2) return;
    this.rt.setSize(s.x, s.y);
    this.uniforms.uPx.value.set(1 / s.x, 1 / s.y);
  }

  render(scene) {
    const cam = this.camera, u = this.uniforms, r = this.renderer;
    const t = Math.tan(cam.fov * Math.PI / 360);
    u.uTan.value.set(t * cam.aspect, t);
    const sz = r.getDrawingBufferSize(new THREE.Vector2());
    if (sz.x < 2 || sz.y < 2) return;
    if (sz.x !== this.rt.width || sz.y !== this.rt.height) this.resize();
    u.uScale.value = sz.y / 1080;
    r.setRenderTarget(this.rt); r.render(scene, cam);
    r.setRenderTarget(null); r.render(this.scene, this.cam);
  }
}
