/** A shoulder–elbow–wrist chain within an already separated arm atlas. */
export interface EntranceArmJoint {
  shoulder: readonly [number, number];
  elbow: readonly [number, number];
  wrist: readonly [number, number];
  /** Follow this fraction of wrist displacement; omitted keeps the shoulder fixed. */
  shoulderFollow?: number;
  /** Optional rotation-led gesture from the atlas pose, in radians; shoulder stays attached. */
  rotation?: { upper: number; elbow: number };
  /** Only this limb. Rotation-led poses include its hand/prop, which follows the forearm rigidly. */
  region: readonly (readonly [number, number])[];
  feather: number;
}

type Point = readonly [number, number];

/** Column-major affine matrix in portrait UVs; rotation is measured in pixels. */
function jointTransform(from: Point, to: Point, angle: number, aspect: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [
    c,
    s * aspect,
    0,
    -s / aspect,
    c,
    0,
    to[0] - c * from[0] + (s * from[1]) / aspect,
    to[1] - s * aspect * from[0] - c * from[1],
    1,
  ];
}

/** Rotate at the attached shoulder, then the elbow; the forearm and hand share one transform. */
export function entranceArmJointRotationPose(
  joint: EntranceArmJoint,
  upperAngle: number,
  elbowAngle: number,
  aspect: number
) {
  const rotateVector = (from: Point, to: Point, angle: number): Point => {
    const x = (to[0] - from[0]) * aspect,
      y = to[1] - from[1];
    return [
      (Math.cos(angle) * x - Math.sin(angle) * y) / aspect,
      Math.sin(angle) * x + Math.cos(angle) * y,
    ];
  };
  const upper = rotateVector(joint.shoulder, joint.elbow, upperAngle);
  const elbow: Point = [joint.shoulder[0] + upper[0], joint.shoulder[1] + upper[1]];
  const lower = rotateVector(joint.elbow, joint.wrist, upperAngle + elbowAngle);
  return {
    upper: jointTransform(joint.shoulder, joint.shoulder, upperAngle, aspect),
    lower: jointTransform(joint.elbow, elbow, upperAngle + elbowAngle, aspect),
    elbow,
    wrist: [elbow[0] + lower[0], elbow[1] + lower[1]] as Point,
  };
}

/** The intact hand/prop drives the wrist; a shoulder may accompany that motion. */
export function entranceArmJointPose(joint: EntranceArmJoint, target: Point, aspect: number) {
  const toPixels = (p: Point): Point => [p[0] * aspect, p[1]];
  const sourceShoulder = toPixels(joint.shoulder),
    e = toPixels(joint.elbow);
  const w = toPixels(joint.wrist),
    t = toPixels(target);
  const follow = joint.shoulderFollow ?? 0;
  const s: Point = [
    sourceShoulder[0] + (t[0] - w[0]) * follow,
    sourceShoulder[1] + (t[1] - w[1]) * follow,
  ];
  const upperLength = Math.hypot(e[0] - sourceShoulder[0], e[1] - sourceShoulder[1]);
  const lowerLength = Math.hypot(w[0] - e[0], w[1] - e[1]);
  const reach = Math.hypot(t[0] - s[0], t[1] - s[1]);
  const distance = Math.max(
    Math.abs(upperLength - lowerLength) + 1e-6,
    Math.min(upperLength + lowerLength - 1e-6, reach)
  );
  const direction =
    reach > 1e-6
      ? [(t[0] - s[0]) / reach, (t[1] - s[1]) / reach]
      : [
          (w[0] - sourceShoulder[0]) /
            Math.hypot(w[0] - sourceShoulder[0], w[1] - sourceShoulder[1]),
          (w[1] - sourceShoulder[1]) /
            Math.hypot(w[0] - sourceShoulder[0], w[1] - sourceShoulder[1]),
        ];
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const side =
    Math.sign(
      (w[0] - sourceShoulder[0]) * (e[1] - sourceShoulder[1]) -
        (w[1] - sourceShoulder[1]) * (e[0] - sourceShoulder[0])
    ) || 1;
  const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)) * side;
  const nextElbow: Point = [
    s[0] + direction[0] * along - direction[1] * height,
    s[1] + direction[1] * along + direction[0] * height,
  ];
  const nextWrist: Point = [s[0] + direction[0] * distance, s[1] + direction[1] * distance];
  const angle = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const elbowUv: Point = [nextElbow[0] / aspect, nextElbow[1]];
  return {
    upper: jointTransform(
      joint.shoulder,
      [s[0] / aspect, s[1]],
      angle(s, nextElbow) - angle(sourceShoulder, e),
      aspect
    ),
    lower: jointTransform(joint.elbow, elbowUv, angle(nextElbow, nextWrist) - angle(e, w), aspect),
    elbow: elbowUv,
    wrist: [nextWrist[0] / aspect, nextWrist[1]] as Point,
  };
}
