// Milliseconds throughout. Portrait, flight and impact share the same completion budget.
const portrait = { enter: 600, fadeAt: 1500, fade: 450, labelAt: 300, label: 200 };
const impact = {
  contact: 0,
  flash: 55,
  burst: 350,
  ring: 350,
  settle: 440,
  shadow: 320,
  neighbors: 350,
  spread: 75,
  shake: 160,
};
const portraitEnd = portrait.fadeAt + portrait.fade;
const landingAt = portraitEnd - 200;
const travel = 400,
  press = 150;
const flight = travel + press;
// All neighbor tails are clamped to this shared impact budget.
const impactDuration = impact.settle;
export const entranceTimeline = {
  portrait,
  portraitEnd,
  landingAt,
  travel,
  press,
  flight,
  flightFade: 45,
  impact,
  impactDuration,
  total: landingAt + flight + impactDuration,
  reduced: 160,
} as const;
export function entranceRemaining(startedAt: number, offset: number, now = performance.now()) {
  return Math.max(0, startedAt + offset - now);
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function entrancePortraitFrame(elapsed: number, reduced: boolean) {
  const enter = 1 - (1 - clamp(elapsed / portrait.enter)) ** 3;
  const exit = clamp((elapsed - portrait.fadeAt) / portrait.fade);
  return {
    finished: elapsed >= (reduced ? entranceTimeline.reduced : portraitEnd),
    opacity: reduced ? 1 : enter * (1 - exit),
    label: reduced ? 1 : 1 - (1 - clamp((elapsed - portrait.labelAt) / portrait.label)) ** 3,
    x: reduced ? 0 : (1 - enter) * 65,
  };
}
