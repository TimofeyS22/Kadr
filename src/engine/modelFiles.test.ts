import { describe, expect, it } from 'vitest';
import manifest from './models.json';
import { absentOnSite, isLarge, mirrored, modelKey, probeAnswer, setModelHosts } from './modelFiles';

const GIGAAM = 'istupakov/gigaam-v3-onnx/resolve/322c3b29492673eb7d0b434bfa9dfb8653e34d02/v3_e2e_ctc.int8.onnx';
const SMALL_WHISPER = 'onnx-community/whisper-small_timestamped/resolve/65caa70f294b46e1c33ff820aae6b16d048ab818/onnx/encoder_model_quantized.onnx';

describe('model files: hosts and the manifest (docs/12 stage 5)', () => {
  setModelHosts({ own: 'https://example.test/Kadr/models/', ranges: 'https://huggingface.co/' });

  it('finds a file by its key on Kadr\'s site, on Hugging Face and on the dev relay', () => {
    expect(modelKey(`https://example.test/Kadr/models/${GIGAAM}`)).toBe(GIGAAM);
    expect(modelKey(`https://huggingface.co/${GIGAAM}`)).toBe(GIGAAM);
    expect(modelKey(`http://localhost:4173/hf/${GIGAAM}?download=1`)).toBe(GIGAAM);
    expect(modelKey('https://example.test/Kadr/models/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/special_tokens_map.json')).toBeNull();
  });

  it('mirrors every repository but Whisper small; large files are the ones split in parts', () => {
    expect(mirrored(GIGAAM)).toBe(true);
    expect(mirrored(SMALL_WHISPER)).toBe(false);
    expect(isLarge(GIGAAM)).toBe(true);
    expect(isLarge('onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx')).toBe(false);
    for (const f of Object.values(manifest.files)) expect(f.parts.length).toBe(Math.ceil(f.size / manifest.part));
  });

  it('knows without asking that the site has no file the manifest leaves out of a mirrored repository', () => {
    const fast = 'istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx/resolve/fb6753736c56de3259d78a26a488548c84b9dccb/';
    // transformers.js 4.3.0 probes onnx/<name>.onnx whatever subfolder it is given: a 404 in the console, live 2026-10-29.
    expect(absentOnSite(`https://example.test/Kadr/models/${fast}onnx/model.int8.onnx`)).toBe(true);
    expect(absentOnSite(`https://example.test/Kadr/models/${fast}model.int8.onnx`)).toBe(false); // listed: the site has it
    expect(absentOnSite(`https://example.test/Kadr/models/${SMALL_WHISPER.replace('encoder_model', 'x')}`)).toBe(false); // not mirrored
    expect(absentOnSite(`https://huggingface.co/${fast}onnx/model.int8.onnx`)).toBe(false); // another host answers for itself
  });

  it('answers transformers.js\'s one-byte probe from the manifest, without the network', async () => {
    const res = probeAnswer(GIGAAM)!;
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-0/${manifest.files[GIGAAM as keyof typeof manifest.files].size}`);
    expect(probeAnswer('nothing/resolve/x/y')).toBeNull();
  });
});
