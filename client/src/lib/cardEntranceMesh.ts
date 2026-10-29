import {
  entranceBlinkFrame,
  entranceBlinkEyeUniforms,
  type EntranceBlinkProfile,
} from './cardEntranceBlink';
import type { EntranceMeshProfile, EntrancePortraitMotion } from './cardEntranceProfiles';
import { entranceLayerFrame } from './cardEntranceArticulation';
import { entranceArmJointPose, entranceArmJointRotationPose } from './cardEntranceArmJoints';
// Shared portrait mesh; optional atlas layers articulate intact hands and props.
// Coordinates are specific to this card-framing concept, not card rules.
export function createCardEntranceMesh(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  profile: EntranceMeshProfile,
  blink?: { image: HTMLImageElement; faces: readonly EntranceBlinkProfile[] }
) {
  const rig = profile.armLayers;
  const joints = rig?.joints ?? [];
  if (
    joints.length > 2 ||
    joints.some((joint) => joint.region.length < 3 || joint.region.length > 8 || joint.feather <= 0)
  )
    throw new Error('Arm atlas supports up to two bounded shoulder–elbow–wrist chains');
  const portraits = profile.portraitLayers;
  const atlas = !!rig || !!portraits?.length;
  const breath = profile.clothBreath;
  const portrait = profile.portraitMotion;
  const part = profile.attachedPart ?? portrait?.attachedPart;
  if (part && (part.region.length < 3 || part.region.length > 8 || part.feather <= 0))
    throw new Error('Attached portrait region requires 3–8 vertices and a positive feather');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: atlas });
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'Shader compilation failed');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      `
    attribute vec2 uv; varying vec2 tex; uniform float time; uniform float amount;
    uniform vec4 rightHairRegion; uniform vec2 rightHairEnd; uniform float hasRightHair;
    uniform vec4 hairRegion; uniform vec2 hairEnd; uniform vec4 hemRegion; uniform vec2 hemEnd; uniform vec3 strength;
    uniform float hasGroupSway; uniform vec4 groupColumns;
    uniform vec3 groupAmplitude; uniform vec3 groupPhase;
    uniform float hasArmLayers; uniform float hasPortraitLayers; uniform float artAspect; uniform float layer;
    uniform vec2 armPivot; uniform vec2 armOffset; uniform vec2 bodyPivot; uniform vec2 bodyBlendY;
    uniform float armAngle; uniform float restAngle; uniform float bodyAngle; uniform float bodyLift;
    uniform float gestureProgress; uniform float bodyProgress; uniform float follow; uniform float rigidBodyFollow;
    uniform vec4 sourceRect; uniform vec4 armPlacement; uniform vec4 bodyPlacement; uniform vec4 foregroundPlacement;
    uniform float independentBody; uniform vec3 sleeveAnchor; uniform vec2 armTravel; uniform vec2 armTravelStart;
    uniform float hasPortraitMotion; uniform vec2 portraitPivot; uniform vec2 portraitBlendY;
    uniform float portraitAngle; uniform vec2 portraitTravel; uniform vec2 portraitAnchorX;
    uniform vec4 portraitFixedCorner; uniform vec4 portraitPlacement;
    uniform int jointCount; uniform int jointRegionCount[2];
    uniform vec2 jointRegion[16]; uniform float jointFeather[2];
    uniform vec2 jointShoulder[2]; uniform vec2 jointElbow[2]; uniform vec2 jointWrist[2];
    uniform mat3 jointUpper[2]; uniform mat3 jointLower[2]; uniform float jointRotationLed[2];
    uniform vec2 partRegion[8]; uniform int partCount; uniform float partFeather;
    uniform vec2 partPivot; uniform float partAngle;
    ${breath ? 'uniform vec4 clothBreathRegion; uniform vec2 clothBreathTravel; uniform vec2 clothBreathTiming;' : ''}
    vec2 rotateAt(vec2 point, vec2 pivot, float angle) {
      // Rotate in image-space pixels, not stretched UV space: faces and hands
      // keep their proportions. Only the configured joint boundaries blend.
      vec2 d=(point-pivot)*vec2(artAspect,1.0);
      d=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*d;
      return pivot+d/vec2(artAspect,1.0);
    }
    float portraitWeight(vec2 point) {
      float upper=1.0-smoothstep(portraitBlendY.x,portraitBlendY.y,point.y)*(1.0-smoothstep(portraitAnchorX.x,portraitAnchorX.y,point.x));
      float pinned=(1.0-smoothstep(portraitFixedCorner.x,portraitFixedCorner.y,point.x))*smoothstep(portraitFixedCorner.z,portraitFixedCorner.w,point.y);
      return upper*(1.0-pinned);
    }
    float attachedWeight(vec2 point) {
      if(partCount<3) return 0.0;
      bool inside=false;
      float edgeDistance=10.0;
      for(int i=0;i<8;i++) {
        if(i>=partCount) break;
        int j=i+1;
        if(j==partCount) j=0;
        vec2 a=partRegion[i], b=partRegion[j];
        if((a.y>point.y)!=(b.y>point.y)) {
          if(point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
        }
        vec2 segment=(b-a)*vec2(artAspect,1.0);
        vec2 relative=(point-a)*vec2(artAspect,1.0);
        float t=clamp(dot(relative,segment)/max(dot(segment,segment),.000001),0.0,1.0);
        edgeDistance=min(edgeDistance,length(relative-segment*t));
      }
      return smoothstep(-partFeather,partFeather,inside?edgeDistance:-edgeDistance);
    }
    vec2 articulatePart(vec2 point, vec2 source) {
      return mix(point,rotateAt(point,partPivot,partAngle*amount),attachedWeight(source));
    }
    float segmentDistance(vec2 point, vec2 a, vec2 b) {
      vec2 d=b-a;
      return length(point-mix(a,b,clamp(dot(point-a,d)/max(dot(d,d),.000001),0.0,1.0)));
    }
    float jointWeight(vec2 point, int chain) {
      bool inside=false;
      float edgeDistance=10.0;
      for(int i=0;i<8;i++) {
        if(i>=jointRegionCount[chain]) break;
        int j=i+1;
        if(j==jointRegionCount[chain]) j=0;
        vec2 a=jointRegion[chain*8+i], b=jointRegion[chain*8+j];
        if((a.y>point.y)!=(b.y>point.y)) {
          if(point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
        }
        edgeDistance=min(edgeDistance,segmentDistance(point*vec2(artAspect,1.0),a*vec2(artAspect,1.0),b*vec2(artAspect,1.0)));
      }
      return smoothstep(-jointFeather[chain],jointFeather[chain],inside?edgeDistance:-edgeDistance);
    }
    vec2 bendArm(vec2 source, vec2 rigid) {
      vec2 posed=rigid;
      for(int chain=0;chain<2;chain++) {
        if(chain>=jointCount) break;
        float coverage=jointWeight(source,chain);
        if(coverage>.0) {
          vec2 pixel=source*vec2(artAspect,1.0);
          vec2 shoulder=jointShoulder[chain]*vec2(artAspect,1.0);
          vec2 elbow=jointElbow[chain]*vec2(artAspect,1.0);
          vec2 wrist=jointWrist[chain]*vec2(artAspect,1.0);
          float upperDistance=segmentDistance(pixel,shoulder,elbow);
          float lowerDistance=segmentDistance(pixel,elbow,wrist);
          float lowerWeight=smoothstep(-.025,.025,upperDistance-lowerDistance);
          vec2 lower=(jointLower[chain]*vec3(source,1.0)).xy;
          vec2 bent=mix((jointUpper[chain]*vec3(source,1.0)).xy,lower,lowerWeight);
          vec2 forearm=wrist-elbow;
          float handWeight=smoothstep(.72,.98,dot(pixel-elbow,forearm)/dot(forearm,forearm));
          // Blend at the wrist decoration; hands and the complete prop stay rigid.
          bent=mix(bent,mix(rigid,lower,jointRotationLed[chain]),handWeight);
          posed=mix(posed,bent,coverage);
        }
      }
      return posed;
    }
    vec2 bodySway(vec2 point, float pivotX, float amplitude, float phase) {
      // A small rigid rotation keeps facial proportions. The waist blend below
      // anchors skirts; damped arrival and slower breathing share the same clock.
      float arrival=exp(-time*2.4)*sin(time*5.0-phase*.35);
      float breath=sin(time*2.5+phase)-sin(phase);
      float angle=amplitude*(arrival+breath*.65);
      vec2 relative=point-vec2(pivotX,.72);
      vec2 rotated=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*relative;
      return rotated-relative+vec2(amplitude*arrival*.35,-amplitude*breath*.42);
    }
    void main(){
      tex=uv; vec2 p=uv;
      if(hasArmLayers>0.5 || hasPortraitLayers>0.5) tex=sourceRect.xy+clamp(uv,vec2(.001),vec2(.999))*sourceRect.zw;
      float settle=exp(-time*2.2)*sin(time*4.3);
      float upper=(1.0-smoothstep(.48,.97,uv.y))*strength.x;
      p.x+=upper*settle*.028*amount;
      p.y-=upper*sin(min(time,1.8)*1.745)*.005*amount;
      float hair=(1.0-smoothstep(hairRegion.x,hairRegion.y,uv.x))*smoothstep(hairRegion.z,hairRegion.w,uv.y)*(1.0-smoothstep(hairEnd.x,hairEnd.y,uv.y))*strength.y;
      hair+=hasRightHair*smoothstep(rightHairRegion.x,rightHairRegion.y,uv.x)*smoothstep(rightHairRegion.z,rightHairRegion.w,uv.y)*(1.0-smoothstep(rightHairEnd.x,rightHairEnd.y,uv.y))*strength.y;
      p.x+=hair*sin(time*4.1-uv.y*6.0)*(.008+.024*exp(-time*1.4))*amount;
      p.y+=hair*sin(time*3.6-uv.x*4.0)*.009*amount;
      float hem=(1.0-smoothstep(hemRegion.x,hemRegion.y,uv.x))*smoothstep(hemRegion.z,hemRegion.w,uv.y)*(1.0-smoothstep(hemEnd.x,hemEnd.y,uv.y))*strength.z;
      p.x+=hem*sin(time*3.5-uv.y*3.0)*(.008+.02*exp(-time*1.2))*amount;
      p.y+=hem*sin(time*3.3-uv.x*4.0)*.012*amount;
      if(hasPortraitMotion<.5 && hasArmLayers<.5) p=articulatePart(p,uv);
      if(hasGroupSway>0.5){
        float left=1.0-smoothstep(groupColumns.x,groupColumns.y,uv.x);
        float right=smoothstep(groupColumns.z,groupColumns.w,uv.x);
        vec2 sway=left*bodySway(uv,.22,groupAmplitude.x,groupPhase.x)
          +(1.0-left-right)*bodySway(uv,.51,groupAmplitude.y,groupPhase.y)
          +right*bodySway(uv,.82,groupAmplitude.z,groupPhase.z);
        p+=sway*(1.0-smoothstep(.48,.92,uv.y))*amount;
      }
      if(hasPortraitMotion>0.5){
        // Head/forehead contacts remain intact. An optional limb moves within
        // its source silhouette, with the soft boundary confined to clothing.
        p=uv+vec2((hair*.012+hem*.004)*follow,hem*.003*follow)*amount;
        if(hasPortraitLayers>0.5) p=portraitPlacement.xy+p*portraitPlacement.zw;
        float partWeight=attachedWeight(uv);
        vec2 bodyPoint=p;
        p=articulatePart(p,uv);
        // Every point of a rigid hand/prop inherits the same torso weight.
        float weight=mix(portraitWeight(hasPortraitLayers>0.5?bodyPoint:uv),portraitWeight(partPivot),partWeight);
        vec2 posed=rotateAt(p,portraitPivot,portraitAngle*bodyProgress)+portraitTravel*bodyProgress;
        p=mix(p,posed,weight*amount);
      }
      if(hasArmLayers>0.5){
        // Hair and cloth trail this gesture, rather than oscillating forever.
        p=uv;
        if(layer<.5){
          p.x+=(hair*.012+hem*.004)*follow*amount;
          p.y+=hem*.003*follow*amount;
          p=bodyPlacement.xy+p*bodyPlacement.zw;
        }else{
          // The full hand / microphone is a rigid layer: no finger stretching.
          p=armPlacement.xy+uv*armPlacement.zw;
          float joint=sleeveAnchor.z>0.0?smoothstep(0.0,sleeveAnchor.z,distance(p,sleeveAnchor.xy)):1.0;
          vec2 rigid=rotateAt(p,armPivot,mix(restAngle,armAngle,amount))+mix(armTravelStart,armTravel,gestureProgress);
          p=(jointCount>0 ? bendArm(p,rigid) : mix(p,rigid,joint))+armOffset;
        }
        float bodyY=(layer>.5 && rigidBodyFollow>.5)?armPivot.y+armOffset.y:p.y;
        float upper=1.0-smoothstep(bodyBlendY.x,bodyBlendY.y,bodyY);
        if(layer<.5 || independentBody<.5){
          p=mix(p,rotateAt(p,bodyPivot,bodyAngle*bodyProgress),upper*amount);
          p.y-=bodyLift*bodyProgress*upper*amount;
        }
        if(layer>1.5) p=foregroundPlacement.xy+uv*foregroundPlacement.zw;
      }
      ${
        breath
          ? `
      // Local translation of fabric, not radial body inflation. Contact/edge vertices stay fixed.
      float breathPhase=clamp((time-clothBreathTiming.x)/clothBreathTiming.y,0.0,1.0);
      float breathRise=.5-.5*cos(breathPhase*6.28318530718);
      float fabric=1.0-smoothstep(0.0,1.0,length((uv-clothBreathRegion.xy)/clothBreathRegion.zw));
      p+=clothBreathTravel*breathRise*fabric*amount;
      `
          : ''
      }
      p=.045+p*.91;
      gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0,1);
    }`
    )
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      `
    precision mediump float; varying vec2 tex; uniform sampler2D art;
    uniform sampler2D blinkArt; uniform float blinkAmount;
    uniform vec4 eyeTarget[2]; uniform vec4 eyeHalf[2]; uniform vec4 eyeClosed[2];
    void main(){
      vec4 color=texture2D(art,tex);
      // Drawn eyelid poses switch as animation cels; crossfading leaves ghost irises.
      float poseIndex=floor(blinkAmount*2.0+.5);
      if(poseIndex>0.0){
        for(int i=0;i<2;i++){
          vec2 local=(tex-eyeTarget[i].xy)/eyeTarget[i].zw;
          float edge=1.0-smoothstep(.82,1.0,length((local-.5)*2.0));
          if(edge>0.0){
            vec4 halfEye=texture2D(blinkArt,eyeHalf[i].xy+local*eyeHalf[i].zw);
            vec4 closedEye=texture2D(blinkArt,eyeClosed[i].xy+local*eyeClosed[i].zw);
            vec4 pose=mix(halfEye,closedEye,poseIndex-1.0);
            color.rgb=mix(color.rgb,pose.rgb,edge*pose.a);
          }
        }
      }
      gl_FragColor=color;
    }`
    )
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'partCount'), part?.region.length ?? 0);
  gl.uniform2fv(
    gl.getUniformLocation(program, 'partRegion[0]'),
    Array.from({ length: 8 }, (_, i) => part?.region[i] ?? [0, 0]).flat()
  );
  gl.uniform1f(gl.getUniformLocation(program, 'partFeather'), part?.feather ?? 0.01);
  gl.uniform2fv(gl.getUniformLocation(program, 'partPivot'), part?.pivot ?? [0, 0]);
  if (breath) {
    gl.uniform4fv(gl.getUniformLocation(program, 'clothBreathRegion'), breath.region);
    gl.uniform2fv(gl.getUniformLocation(program, 'clothBreathTravel'), breath.travel);
    gl.uniform2f(
      gl.getUniformLocation(program, 'clothBreathTiming'),
      breath.start,
      breath.duration
    );
  }
  const partAngle = gl.getUniformLocation(program, 'partAngle');
  gl.uniform1f(
    gl.getUniformLocation(program, 'hasPortraitMotion'),
    portrait || portraits?.length ? 1 : 0
  );
  gl.uniform1f(gl.getUniformLocation(program, 'hasPortraitLayers'), portraits?.length ? 1 : 0);
  const portraitPlacement = gl.getUniformLocation(program, 'portraitPlacement');
  const portraitUniforms = Object.fromEntries(
    [
      'portraitPivot',
      'portraitBlendY',
      'portraitAngle',
      'portraitTravel',
      'portraitAnchorX',
      'portraitFixedCorner',
    ].map((name) => [name, gl.getUniformLocation(program, name)])
  );
  const setPortrait = (pose?: Omit<EntrancePortraitMotion, 'attachedPart'>) => {
    gl.uniform2fv(portraitUniforms.portraitPivot, pose?.pivot ?? [0, 0]);
    gl.uniform2fv(portraitUniforms.portraitBlendY, pose?.blendY ?? [0, 1]);
    gl.uniform1f(portraitUniforms.portraitAngle, pose?.angle ?? 0);
    gl.uniform2fv(portraitUniforms.portraitTravel, pose?.travel ?? [0, 0]);
    gl.uniform2fv(portraitUniforms.portraitAnchorX, pose?.anchorX ?? [1, 1.01]);
    gl.uniform4fv(portraitUniforms.portraitFixedCorner, pose?.fixedCorner ?? [-1, 0, 1, 2]);
  };
  setPortrait(portrait);
  gl.uniform1f(gl.getUniformLocation(program, 'hasArmLayers'), rig ? 1 : 0);
  const artAspect =
    (image.naturalWidth / image.naturalHeight) *
    (rig
      ? rig.bodyCrop[2] / rig.bodyCrop[3]
      : portraits?.length
        ? portraits[0].crop[2] / portraits[0].crop[3]
        : 1) *
    (rig?.bodyPlacement ? rig.bodyPlacement[3] / rig.bodyPlacement[2] : 1);
  gl.uniform1f(gl.getUniformLocation(program, 'artAspect'), artAspect);
  gl.uniform1i(gl.getUniformLocation(program, 'jointCount'), joints.length);
  gl.uniform1fv(
    gl.getUniformLocation(program, 'jointRotationLed[0]'),
    [0, 1].map((i) => (joints[i]?.rotation ? 1 : 0))
  );
  gl.uniform1iv(
    gl.getUniformLocation(program, 'jointRegionCount[0]'),
    [0, 1].map((i) => joints[i]?.region.length ?? 0)
  );
  gl.uniform1fv(
    gl.getUniformLocation(program, 'jointFeather[0]'),
    [0, 1].map((i) => joints[i]?.feather ?? 0.01)
  );
  gl.uniform2fv(
    gl.getUniformLocation(program, 'jointRegion[0]'),
    [0, 1].flatMap((i) =>
      Array.from({ length: 8 }, (_, j) => joints[i]?.region[j] ?? [0, 0]).flat()
    )
  );
  for (const [field, uniform] of [
    ['shoulder', 'jointShoulder'],
    ['elbow', 'jointElbow'],
    ['wrist', 'jointWrist'],
  ] as const)
    gl.uniform2fv(
      gl.getUniformLocation(program, `${uniform}[0]`),
      [0, 1].flatMap((i) => joints[i]?.[field] ?? [0, 0])
    );
  const jointUpper = gl.getUniformLocation(program, 'jointUpper[0]');
  const jointLower = gl.getUniformLocation(program, 'jointLower[0]');
  gl.uniform2fv(gl.getUniformLocation(program, 'armPivot'), rig?.pivot ?? [0, 0]);
  gl.uniform2fv(gl.getUniformLocation(program, 'armOffset'), rig?.offset ?? [0, 0]);
  gl.uniform2fv(gl.getUniformLocation(program, 'bodyPivot'), rig?.bodyPivot ?? [0, 0]);
  gl.uniform2fv(
    gl.getUniformLocation(program, 'bodyBlendY'),
    rig?.bodyBlendY ?? [(rig?.bodyPivot[1] ?? 0) - 0.06, (rig?.bodyPivot[1] ?? 0) + 0.1]
  );
  gl.uniform1f(gl.getUniformLocation(program, 'bodyAngle'), rig?.bodyAngle ?? 0);
  gl.uniform1f(gl.getUniformLocation(program, 'bodyLift'), rig?.bodyLift ?? 0);
  gl.uniform4fv(gl.getUniformLocation(program, 'armPlacement'), rig?.armPlacement ?? [0, 0, 1, 1]);
  gl.uniform4fv(
    gl.getUniformLocation(program, 'foregroundPlacement'),
    rig?.foreground?.placement ?? [0, 0, 1, 1]
  );
  gl.uniform4fv(
    gl.getUniformLocation(program, 'bodyPlacement'),
    rig?.bodyPlacement ?? [0, 0, 1, 1]
  );
  gl.uniform1f(gl.getUniformLocation(program, 'independentBody'), rig?.independentBody ? 1 : 0);
  gl.uniform3fv(gl.getUniformLocation(program, 'sleeveAnchor'), rig?.sleeveAnchor ?? [0, 0, 0]);
  gl.uniform2fv(gl.getUniformLocation(program, 'armTravel'), rig?.armTravel ?? [0, 0]);
  gl.uniform2fv(gl.getUniformLocation(program, 'armTravelStart'), rig?.armTravelStart ?? [0, 0]);
  gl.uniform1f(gl.getUniformLocation(program, 'rigidBodyFollow'), rig?.rigidBodyFollow ? 1 : 0);
  const sourceRect = gl.getUniformLocation(program, 'sourceRect');
  const layer = gl.getUniformLocation(program, 'layer');
  const armAngle = gl.getUniformLocation(program, 'armAngle');
  gl.uniform1f(gl.getUniformLocation(program, 'restAngle'), rig?.angles[1] ?? 0);
  const gestureProgress = gl.getUniformLocation(program, 'gestureProgress');
  const bodyProgress = gl.getUniformLocation(program, 'bodyProgress');
  const follow = gl.getUniformLocation(program, 'follow');
  if (atlas) {
    gl.enable(gl.BLEND);
    // Straight-alpha texture is blended into a premultiplied-alpha canvas.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.uniform4fv(gl.getUniformLocation(program, 'hairRegion'), profile.hair);
  gl.uniform2fv(gl.getUniformLocation(program, 'hairEnd'), profile.hairEnd);
  const rightHair = profile.rightHair ?? [0, 1, 0, 1, 0, 1];
  gl.uniform4fv(gl.getUniformLocation(program, 'rightHairRegion'), rightHair.slice(0, 4));
  gl.uniform2fv(gl.getUniformLocation(program, 'rightHairEnd'), rightHair.slice(4));
  gl.uniform1f(gl.getUniformLocation(program, 'hasRightHair'), profile.rightHair ? 1 : 0);
  gl.uniform4fv(gl.getUniformLocation(program, 'hemRegion'), profile.hem);
  gl.uniform2fv(gl.getUniformLocation(program, 'hemEnd'), profile.hemEnd ?? [1, 1.01]);
  gl.uniform3fv(gl.getUniformLocation(program, 'strength'), profile.strength);
  gl.uniform1f(gl.getUniformLocation(program, 'hasGroupSway'), profile.groupSway ? 1 : 0);
  gl.uniform4fv(
    gl.getUniformLocation(program, 'groupColumns'),
    profile.groupSway?.columns ?? [0, 0.3, 0.7, 1]
  );
  gl.uniform3fv(
    gl.getUniformLocation(program, 'groupAmplitude'),
    profile.groupSway?.amplitude ?? [0, 0, 0]
  );
  gl.uniform3fv(
    gl.getUniformLocation(program, 'groupPhase'),
    profile.groupSway?.phase ?? [0, 0, 0]
  );
  const vertices = [];
  const n = 60;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = x / n,
        b = y / n,
        c = (x + 1) / n,
        d = (y + 1) / n;
      vertices.push(a, b, c, b, a, d, a, d, c, b, c, d);
    }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  const uv = gl.getAttribLocation(program, 'uv');
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.uniform1i(gl.getUniformLocation(program, 'art'), 0);
  let blinkTexture: WebGLTexture | null = null;
  const blinkAmount = gl.getUniformLocation(program, 'blinkAmount');
  gl.uniform1i(gl.getUniformLocation(program, 'blinkArt'), 1);
  // WebGL requires a complete texture even on an inactive sampler branch.
  gl.activeTexture(gl.TEXTURE1);
  if (blink) {
    blinkTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blinkTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blink.image);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }
  gl.activeTexture(gl.TEXTURE0);
  const time = gl.getUniformLocation(program, 'time'),
    amount = gl.getUniformLocation(program, 'amount');
  const eyeUniforms = (
    [
      ['target', 'eyeTarget'],
      ['half', 'eyeHalf'],
      ['closed', 'eyeClosed'],
    ] as const
  ).map(([key, uniform]) => ({
    key,
    location: gl.getUniformLocation(program, `${uniform}[0]`),
  }));
  let activeFace: EntranceBlinkProfile | null = null;
  const draw = (seconds: number, reduced: boolean) => {
    const w = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2)),
      h = Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(time, seconds);
    const blinkFrame = blink ? entranceBlinkFrame(seconds, blink.faces, reduced) : null;
    if (blinkFrame && blinkFrame.face !== activeFace) {
      activeFace = blinkFrame.face;
      for (const { key, location } of eyeUniforms)
        gl.uniform4fv(location, entranceBlinkEyeUniforms(activeFace, key));
    }
    gl.uniform1f(blinkAmount, blinkFrame?.amount ?? 0);
    gl.uniform1f(amount, reduced ? 0 : 1);
    const timing = rig ?? portrait;
    const motion = timing ? entranceLayerFrame(seconds, timing, reduced) : null;
    gl.uniform1f(gestureProgress, motion?.arm ?? 0);
    gl.uniform1f(bodyProgress, motion?.body ?? 0);
    const rotationProgress = rig?.rotationMotion
      ? entranceLayerFrame(seconds, rig.rotationMotion, reduced).arm
      : (motion?.arm ?? 0);
    const currentArmAngle = rig
      ? rig.angles[0] + (rig.angles[1] - rig.angles[0]) * rotationProgress
      : 0;
    gl.uniform1f(armAngle, currentArmAngle);
    gl.uniform1f(follow, motion?.follow ?? 0);
    if (rig && joints.length) {
      const progress = motion!.arm;
      const angle = currentArmAngle;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const travel = [0, 1].map(
        (i) =>
          (rig.armTravelStart?.[i] ?? 0) * (1 - progress) + (rig.armTravel?.[i] ?? 0) * progress
      );
      const poses = joints.map((joint) => {
        if (joint.rotation)
          return entranceArmJointRotationPose(
            joint,
            reduced ? 0 : joint.rotation.upper * progress,
            reduced ? 0 : joint.rotation.elbow * progress,
            artAspect
          );
        const dx = (joint.wrist[0] - rig.pivot[0]) * artAspect;
        const dy = joint.wrist[1] - rig.pivot[1];
        return entranceArmJointPose(
          joint,
          [
            rig.pivot[0] + (c * dx - s * dy) / artAspect + travel[0],
            rig.pivot[1] + s * dx + c * dy + travel[1],
          ],
          artAspect
        );
      });
      const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      gl.uniformMatrix3fv(
        jointUpper,
        false,
        [0, 1].flatMap((i) => poses[i]?.upper ?? identity)
      );
      gl.uniformMatrix3fv(
        jointLower,
        false,
        [0, 1].flatMap((i) => poses[i]?.lower ?? identity)
      );
    }
    const partProgress = part ? entranceLayerFrame(seconds, part, reduced).arm : 0;
    gl.uniform1f(
      partAngle,
      part ? part.angles[0] + (part.angles[1] - part.angles[0]) * partProgress : 0
    );
    if (portraits?.length) {
      for (const panel of portraits) {
        const frame = entranceLayerFrame(seconds, panel.motion, reduced);
        setPortrait(panel.motion);
        gl.uniform1f(bodyProgress, frame.body);
        gl.uniform1f(follow, frame.follow);
        gl.uniform4fv(portraitPlacement, panel.placement);
        gl.uniform4fv(sourceRect, panel.crop);
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
      }
      return;
    }
    const drawLayer = (isArm: boolean) => {
      gl.uniform4fv(sourceRect, isArm ? rig!.armCrop : (rig?.bodyCrop ?? [0, 0, 1, 1]));
      gl.uniform1f(layer, isArm ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
    };
    if (rig?.behindBody) drawLayer(true);
    drawLayer(false);
    if (rig && !rig.behindBody) drawLayer(true);
    if (rig?.foreground) {
      gl.uniform4fv(sourceRect, rig.foreground.crop);
      gl.uniform1f(layer, 2);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
    }
  };
  return {
    draw,
    dispose() {
      for (const shader of gl.getAttachedShaders(program) ?? []) gl.deleteShader(shader);
      gl.deleteTexture(texture);
      if (blinkTexture) gl.deleteTexture(blinkTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
