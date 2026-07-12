precision highp float;

// Liquid-glass refraction — final pass.
//
// Refracts the composited scene behind the card at the rim of a rounded
// rectangle. The scene copy is the page background (and, once the scene
// registry is live, live proxies) rasterised in card space:
//   • uScene — the scene slice, in card space. It only changes when the card
//              moves/resizes or a proxy behind it goes dirty, so it is uploaded
//              via texImage2D on geometry change and patched via texSubImage2D
//              on scene dirt — not per frame.
//
// The rim displacement is derived analytically from the rounded-rectangle SDF
// (centre optically clear; the bend ramps up across a shoulder at the rim along
// the inward normal), and each colour channel is sampled at a slightly different
// scale for the red/blue fringe — chromatic aberration. `blur` + `saturate`
// stay as CSS filters on this canvas (GPU-accelerated; only SVG `url()` was not).
//
// Rim reflection: the scene texture is already bound, so a single extra sample
// taken a few CSS px *outward* along the rim normal is mixed into the rim,
// weighted by uReflect. uReflect = 0.0 leaves the refracted output untouched.

uniform sampler2D uScene;     // scene slice, card space
uniform vec2  uResolution;    // card canvas size, drawing-buffer px
uniform float uDpr;           // drawing-buffer px per CSS px
uniform float uRadius;        // corner radius, CSS px (measured from computed style)
uniform float uBevel;         // refractive shoulder width, CSS px
uniform float uStrength;      // peak edge displacement, CSS px
uniform float uCurvature;     // shoulder ramp steepness
uniform float uChroma;        // chromatic aberration spread, 0–1
uniform float uReflect;       // rim reflection weight, 0 disables it

varying vec2 vUv;

float smooth01(float t) {
  float x = clamp(t, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

// Inigo Quilez's rounded-box SDF: negative inside, 0 on the border, positive out.
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

// The scene copy at a card-space uv: the composited scene slice sampled in card
// space (the contour-field layer of the personal-site port is dropped, so the
// backdrop reduces to the scene sample alone).
vec3 backdrop(vec2 cardUv) {
  return texture2D(uScene, cardUv).rgb;
}

// Distance, in CSS px, a rim reflection sample reaches outward along the normal.
const float REFLECT_PX = 3.0;

void main() {
  // Work in CSS px with the origin at the card centre — the space buildMap used.
  vec2 sizeCss = uResolution / uDpr;
  vec2 halfExt = sizeCss * 0.5;
  vec2 p = vUv * sizeCss - halfExt;
  vec2 b = halfExt;

  vec2 dir = vec2(0.0);       // inward refraction direction × ramp, 0 over the flat interior
  vec2 rimNormal = vec2(0.0); // outward unit normal at the rim, 0 over the interior
  float rimWeight = 0.0;      // shoulder ramp, 0 over the interior up to 1 at the rim
  float sd = sdRoundBox(p, b, uRadius);
  if (sd < 0.0) {
    float t = (sd + uBevel) / uBevel; // 0 a bevel deep, 1 at the rim
    if (t > 0.0) {
      float m = pow(smooth01(t), uCurvature);
      // Outward normal = gradient of the SDF, central differences at e = 0.75px.
      float e = 0.75;
      float nx = sdRoundBox(p + vec2(e, 0.0), b, uRadius) - sdRoundBox(p - vec2(e, 0.0), b, uRadius);
      float ny = sdRoundBox(p + vec2(0.0, e), b, uRadius) - sdRoundBox(p - vec2(0.0, e), b, uRadius);
      float len = max(length(vec2(nx, ny)), 1e-6);
      vec2 n = vec2(nx, ny) / len;
      // Negate the outward normal to pull the copy inward (magnifying the rim
      // like thick glass).
      dir = -n * m;
      rimNormal = n;
      rimWeight = m;
    }
  }

  // Per-channel displacement in CSS px → card uv. Red bends most, blue least.
  vec2 toUv = 1.0 / sizeCss;
  vec2 offR = dir * (uStrength * (1.0 + uChroma)) * toUv;
  vec2 offG = dir * (uStrength) * toUv;
  vec2 offB = dir * (uStrength * (1.0 - uChroma)) * toUv;

  float r = backdrop(vUv + offR).r;
  float g = backdrop(vUv + offG).g;
  float bl = backdrop(vUv + offB).b;
  vec3 refracted = vec3(r, g, bl);

  // Rim reflection: a scene sample a few CSS px outward along the rim normal,
  // mixed into the rim. uReflect = 0.0 reproduces the refracted output exactly.
  vec3 reflection = backdrop(vUv + rimNormal * (REFLECT_PX * toUv));
  gl_FragColor = vec4(mix(refracted, reflection, uReflect * rimWeight), 1.0);
}
