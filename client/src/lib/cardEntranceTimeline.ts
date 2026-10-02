// Milliseconds throughout. Changing a phase updates dependent deadlines and CSS together.
const portrait = { enter: 600, fadeAt: 1500, fade: 450, labelAt: 300, label: 200 };
const impact = {
  contact: 0,
  flash: 110,
  ring: 350,
  echoDelay: 60,
  echo: 380,
  dust: 340,
  spark: 310,
  shadow: 320,
  neighbors: 350,
  spread: 75,
  shake: 210,
};
const portraitEnd = portrait.fadeAt + portrait.fade;
const landingAt = portraitEnd - 200;
const travel = 400,
  press = 150;
const flight = travel + press;
const impactDuration = Math.max(
  impact.flash,
  impact.contact + impact.ring,
  impact.echoDelay + impact.echo,
  impact.contact + impact.dust,
  impact.contact + impact.spark,
  impact.contact + impact.shadow,
  impact.contact + impact.spread + impact.neighbors,
  impact.contact + impact.shake
);
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
export const entranceImpactCss = Object.fromEntries(
  Object.entries(impact).map(([key, ms]) => [`--impact-${key}`, `${ms}ms`])
);
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
