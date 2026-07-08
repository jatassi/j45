precision highp float;

// Liquid-glass refraction — final pass.
//
// Refracts the page's background gradient at the rim of a rounded rectangle.
// The backdrop copy is simply the page-background slice sampled in card space:
//   • uGradient — the page background slice, in card space. It only changes
//                 when the card moves/resizes, so it is uploaded once per
//                 geometry change, not per frame.
//
// The rim displacement is derived analytically from the rounded-rectangle SDF
// (centre optically clear; the bend ramps up across a shoulder at the rim along
// the inward normal), and each colour channel is sampled at a slightly different
// scale for the red/blue fringe — chromatic aberration. `blur` + `saturate`
// stay as CSS filters on this canvas (GPU-accelerated; only SVG `url()` was not).

uniform sampler2D uGradient;  // page background slice, card space
uniform vec2  uResolution;    // card canvas size, drawing-buffer px
uniform float uDpr;           // drawing-buffer px per CSS px
uniform float uRadius;        // corner radius, CSS px (measured from computed style)
uniform float uBevel;         // refractive shoulder width, CSS px
uniform float uStrength;      // peak edge displacement, CSS px
uniform float uCurvature;     // shoulder ramp steepness
uniform float uChroma;        // chromatic aberration spread, 0–1

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

// The backdrop copy at a card-space uv: the page background gradient sampled in
// card space (the contour-field layer of the personal-site port is dropped, so
// backdrop reduces to the gradient alone).
vec3 backdrop(vec2 cardUv) {
  return texture2D(uGradient, cardUv).rgb;
}

void main() {
  // Work in CSS px with the origin at the card centre — the space buildMap used.
  vec2 sizeCss = uResolution / uDpr;
  vec2 halfExt = sizeCss * 0.5;
  vec2 p = vUv * sizeCss - halfExt;
  vec2 b = halfExt;

  vec2 dir = vec2(0.0); // inward refraction direction × ramp, 0 over the flat interior
  float sd = sdRoundBox(p, b, uRadius);
  if (sd < 0.0) {
    float t = (sd + uBevel) / uBevel; // 0 a bevel deep, 1 at the rim
    if (t > 0.0) {
      float m = pow(smooth01(t), uCurvature);
      // Outward normal = gradient of the SDF, central differences at e = 0.75px,
      // negated to pull the copy inward (magnifying the rim like thick glass).
      float e = 0.75;
      float nx = sdRoundBox(p + vec2(e, 0.0), b, uRadius) - sdRoundBox(p - vec2(e, 0.0), b, uRadius);
      float ny = sdRoundBox(p + vec2(0.0, e), b, uRadius) - sdRoundBox(p - vec2(0.0, e), b, uRadius);
      float len = max(length(vec2(nx, ny)), 1e-6);
      dir = (-vec2(nx, ny) / len) * m;
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
  gl_FragColor = vec4(r, g, bl, 1.0);
}
