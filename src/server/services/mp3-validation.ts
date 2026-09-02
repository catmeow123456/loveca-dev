interface MpegAudioFrame {
  readonly version: 1 | 2 | 2.5;
  readonly layer: 1 | 2 | 3;
  readonly sampleRate: number;
  readonly byteLength: number;
}

const MPEG_1_BITRATES: Readonly<Record<1 | 2 | 3, readonly number[]>> = {
  1: [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
const MPEG_2_BITRATES: Readonly<Record<1 | 2 | 3, readonly number[]>> = {
  1: [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

export function isStructurallyValidMp3(value: Buffer): boolean {
  const audioOffset = readId3v2AudioOffset(value);
  if (audioOffset === null) return false;
  const firstFrame = readMpegAudioFrame(value, audioOffset);
  if (!firstFrame) return false;
  const secondFrame = readMpegAudioFrame(value, audioOffset + firstFrame.byteLength);
  return (
    secondFrame !== null &&
    secondFrame.version === firstFrame.version &&
    secondFrame.layer === firstFrame.layer &&
    secondFrame.sampleRate === firstFrame.sampleRate
  );
}

function readId3v2AudioOffset(value: Buffer): number | null {
  if (value.subarray(0, 3).toString('ascii') !== 'ID3') return 0;
  if (value.length < 10) return null;
  const majorVersion = value[3]!;
  const flags = value[5]!;
  const sizeBytes = [value[6]!, value[7]!, value[8]!, value[9]!];
  if (majorVersion < 2 || majorVersion > 4 || sizeBytes.some((byte) => (byte & 0x80) !== 0)) {
    return null;
  }
  const tagSize = sizeBytes.reduce((size, byte) => (size << 7) | byte, 0);
  const footerSize = majorVersion === 4 && (flags & 0x10) !== 0 ? 10 : 0;
  const audioOffset = 10 + tagSize + footerSize;
  return audioOffset <= value.length ? audioOffset : null;
}

function readMpegAudioFrame(value: Buffer, offset: number): MpegAudioFrame | null {
  if (offset < 0 || offset + 4 > value.length) return null;
  const byte1 = value[offset]!;
  const byte2 = value[offset + 1]!;
  const byte3 = value[offset + 2]!;
  if (byte1 !== 0xff || (byte2 & 0xe0) !== 0xe0) return null;

  const versionBits = (byte2 >> 3) & 0x03;
  const layerBits = (byte2 >> 1) & 0x03;
  const bitrateIndex = byte3 >> 4;
  const sampleRateIndex = (byte3 >> 2) & 0x03;
  if (
    versionBits === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null;
  }

  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const bitrateTable = version === 1 ? MPEG_1_BITRATES : MPEG_2_BITRATES;
  const bitrate = bitrateTable[layer][bitrateIndex - 1]! * 1000;
  const baseSampleRate = [44_100, 48_000, 32_000][sampleRateIndex]!;
  const sampleRate =
    version === 1 ? baseSampleRate : version === 2 ? baseSampleRate / 2 : baseSampleRate / 4;
  const padding = (byte3 >> 1) & 0x01;
  const byteLength =
    layer === 1
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor(((layer === 3 && version !== 1 ? 72 : 144) * bitrate) / sampleRate) + padding;
  if (byteLength < 4 || offset + byteLength > value.length) return null;
  return { version, layer, sampleRate, byteLength };
}
