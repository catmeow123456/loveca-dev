import { describe, expect, it } from 'vitest';
import {
  entranceArmJointPose,
  entranceArmJointRotationPose,
  type EntranceArmJoint,
} from '../../client/src/lib/cardEntranceArmJoints';
import { cardEntranceProfiles } from '../../client/src/lib/cardEntranceProfiles';
import { entranceLayerFrame } from '../../client/src/lib/cardEntranceArticulation';

type Point = readonly [number, number];
const distance = (a: Point, b: Point, aspect: number) =>
  Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
const transform = (matrix: number[], point: Point): Point => [
  matrix[0] * point[0] + matrix[3] * point[1] + matrix[6],
  matrix[1] * point[0] + matrix[4] * point[1] + matrix[7],
];
const closePoint = (actual: Point, expected: Point) => {
  expect(actual[0]).toBeCloseTo(expected[0], 8);
  expect(actual[1]).toBeCloseTo(expected[1], 8);
};
const chain: EntranceArmJoint = {
  shoulder: [0.2, 0.3],
  elbow: [0.23, 0.6],
  wrist: [0.6, 0.4],
  region: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  feather: 0.01,
};

describe('atlas arm joint constraints', () => {
  it.each([0.65, 1, 1.4])(
    'pins the shoulder and preserves both bone lengths at aspect %s',
    (aspect) => {
      for (const target of [
        [0.6, 0.4],
        [0.58, 0.34],
        [0.55, 0.32],
      ] as const) {
        const pose = entranceArmJointPose(chain, target, aspect);
        closePoint(transform(pose.upper, chain.shoulder), chain.shoulder);
        closePoint(transform(pose.upper, chain.elbow), pose.elbow);
        closePoint(transform(pose.lower, chain.elbow), pose.elbow);
        closePoint(transform(pose.lower, chain.wrist), target);
        expect(distance(chain.shoulder, pose.elbow, aspect)).toBeCloseTo(
          distance(chain.shoulder, chain.elbow, aspect),
          8
        );
        expect(distance(pose.elbow, pose.wrist, aspect)).toBeCloseTo(
          distance(chain.elbow, chain.wrist, aspect),
          8
        );
        // Neither segment scales the image-space skin texture.
        expect(
          distance(transform(pose.lower, [0.3, 0.4]), transform(pose.lower, [0.4, 0.5]), aspect)
        ).toBeCloseTo(distance([0.3, 0.4], [0.4, 0.5], aspect), 8);
      }
    }
  );

  it('keeps the original bend side for mirrored arms', () => {
    for (const sign of [-1, 1]) {
      const mirrored = { ...chain, elbow: [0.3, 0.45 + sign * 0.2] as Point };
      const target: Point = [0.58, 0.37];
      const pose = entranceArmJointPose(mirrored, target, 1);
      const cross = (w: Point, e: Point) =>
        (w[0] - chain.shoulder[0]) * (e[1] - chain.shoulder[1]) -
        (w[1] - chain.shoulder[1]) * (e[0] - chain.shoulder[0]);
      expect(Math.sign(cross(target, pose.elbow))).toBe(
        Math.sign(cross(chain.wrist, mirrored.elbow))
      );
    }
  });

  it('lets the shoulder accompany the wrist without changing either bone length', () => {
    const moving = { ...chain, shoulderFollow: 0.6 };
    const target: Point = [0.57, 0.35];
    const aspect = 0.7;
    const pose = entranceArmJointPose(moving, target, aspect);
    const shoulder: Point = [
      chain.shoulder[0] + (target[0] - chain.wrist[0]) * 0.6,
      chain.shoulder[1] + (target[1] - chain.wrist[1]) * 0.6,
    ];
    closePoint(transform(pose.upper, chain.shoulder), shoulder);
    closePoint(transform(pose.upper, chain.elbow), pose.elbow);
    closePoint(transform(pose.lower, chain.elbow), pose.elbow);
    closePoint(transform(pose.lower, chain.wrist), target);
    expect(distance(shoulder, pose.elbow, aspect)).toBeCloseTo(
      distance(chain.shoulder, chain.elbow, aspect),
      8
    );
    expect(distance(pose.elbow, pose.wrist, aspect)).toBeCloseTo(
      distance(chain.elbow, chain.wrist, aspect),
      8
    );
  });

  it('clamps unreachable requests to a finite pose without lengthening the arm', () => {
    for (const target of [[5, 5], chain.shoulder] as const) {
      const pose = entranceArmJointPose(chain, target, 0.7);
      expect(
        [...pose.upper, ...pose.lower, ...pose.elbow, ...pose.wrist].every(Number.isFinite)
      ).toBe(true);
      expect(distance(chain.shoulder, pose.elbow, 0.7)).toBeCloseTo(
        distance(chain.shoulder, chain.elbow, 0.7),
        8
      );
      expect(distance(pose.elbow, pose.wrist, 0.7)).toBeCloseTo(
        distance(chain.elbow, chain.wrist, 0.7),
        8
      );
    }
  });

  it('Maki keeps its actual hand path reachable throughout playback', () => {
    const profile = cardEntranceProfiles.find((p) => p.id === 'maki-bp8')!;
    const rig = profile.mesh.armLayers!;
    const aspect = 749 / 1050;
    for (let step = 0; step <= 100; step++) {
      const seconds = step * 0.016;
      const progress = entranceLayerFrame(seconds, rig, false).arm;
      const rotation = entranceLayerFrame(seconds, rig.rotationMotion ?? rig, false).arm;
      const angle = rig.angles[0] + (rig.angles[1] - rig.angles[0]) * rotation;
      for (const joint of rig.joints!) {
        const dx = (joint.wrist[0] - rig.pivot[0]) * aspect,
          dy = joint.wrist[1] - rig.pivot[1];
        const target: Point = [
          rig.pivot[0] +
            (Math.cos(angle) * dx - Math.sin(angle) * dy) / aspect +
            (rig.armTravelStart?.[0] ?? 0) * (1 - progress) +
            (rig.armTravel?.[0] ?? 0) * progress,
          rig.pivot[1] +
            Math.sin(angle) * dx +
            Math.cos(angle) * dy +
            (rig.armTravelStart?.[1] ?? 0) * (1 - progress) +
            (rig.armTravel?.[1] ?? 0) * progress,
        ];
        closePoint(entranceArmJointPose(joint, target, aspect).wrist, target);
      }
    }
  });

  it.each([0.65, 1, 1.4])(
    'rotation-led poses keep the attachment and rigid segments at aspect %s',
    (aspect) => {
      for (const [upper, elbow] of [
        [0, 0],
        [-0.03, 0.08],
        [0.04, -0.12],
      ]) {
        const pose = entranceArmJointRotationPose(chain, upper, elbow, aspect);
        closePoint(transform(pose.upper, chain.shoulder), chain.shoulder);
        closePoint(transform(pose.upper, chain.elbow), pose.elbow);
        closePoint(transform(pose.lower, chain.elbow), pose.elbow);
        closePoint(transform(pose.lower, chain.wrist), pose.wrist);
        expect(distance(chain.shoulder, pose.elbow, aspect)).toBeCloseTo(
          distance(chain.shoulder, chain.elbow, aspect),
          8
        );
        expect(distance(pose.elbow, pose.wrist, aspect)).toBeCloseTo(
          distance(chain.elbow, chain.wrist, aspect),
          8
        );
        expect(
          distance(transform(pose.lower, [0.7, 0.38]), transform(pose.lower, [0.8, 0.42]), aspect)
        ).toBeCloseTo(distance([0.7, 0.38], [0.8, 0.42], aspect), 8);
      }
    }
  );

  it('Dia keeps the shoulder/sleeve attached while the forearm and hand settle', () => {
    const rig = cardEntranceProfiles.find((p) => p.id === 'dia-cl1')!.mesh.armLayers!;
    const joint = rig.joints![0],
      aspect = 824 / 1049;
    for (let step = 0; step <= 100; step++) {
      const progress = entranceLayerFrame(step * 0.016, rig, false).arm;
      const pose = entranceArmJointRotationPose(
        joint,
        joint.rotation!.upper * progress,
        joint.rotation!.elbow * progress,
        aspect
      );
      // Upper sleeve and visible upper-arm skin do not slide into the body's sleeve.
      for (const point of [joint.shoulder, joint.elbow, [0.47, 0.64] as Point]) {
        closePoint(transform(pose.upper, point), point);
      }
      closePoint(transform(pose.lower, joint.elbow), joint.elbow);
      expect(distance(pose.elbow, pose.wrist, aspect)).toBeCloseTo(
        distance(joint.elbow, joint.wrist, aspect),
        8
      );
    }
  });
});
